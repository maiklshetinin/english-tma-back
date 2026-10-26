// Путь, пресеты и колоды слов. Сайт правит их целиком (autosave): сервер проверяет форму данных (clean.ts) и роль.
//  • paths/<id ученика>   — путь ученика: юниты и кружки. Пишет преподаватель; ученик может только отметить текущий кружок выполненным.
//  • presets/<id>         — пресеты пути (заготовки без дат), общие для преподавателей.
//  • decks/<id>           — колоды слов вместе с карточками; кому назначены (forAll / assigned).
// Выполненный кружок остаётся выполненным: целиком сохранённый путь не может «снять» отметку (в интерфейсе такой кнопки нет),
// поэтому отметка ученика не теряется, даже если у преподавателя открыта старая версия пути.
import type { Firestore, FieldValue as FV, QueryDocumentSnapshot } from 'firebase-admin/firestore'
import { fail } from './login.js'
import { makeAccess } from './access.js'
import { cleanDeck, cleanPreset, cleanUnits, id } from './clean.js'
import type { CompleteResponse, ContentResponse, Deck, DeckDoc, PathUnit, Preset, PresetDoc, TokenUser } from './types.js'

export interface ContentDeps { db: Firestore; FieldValue: Pick<typeof FV, 'serverTimestamp'>; now?: () => number }

const byCreated = (a: QueryDocumentSnapshot, b: QueryDocumentSnapshot) => (a.get('createdMs') ?? 0) - (b.get('createdMs') ?? 0) || a.id.localeCompare(b.id)
const pubPreset = (d: QueryDocumentSnapshot): Preset => { const x = d.data() as PresetDoc; return { id: d.id, name: x.name, units: x.units ?? [] } }
const pubDeck = (d: QueryDocumentSnapshot): Deck => {
  const x = d.data() as DeckDoc
  return { id: d.id, title: x.title, forAll: !!x.forAll, assigned: x.assigned ?? [], newPerDay: x.newPerDay ?? 20, source: x.source ?? { url: '', lastSync: null }, cards: x.cards ?? [] }
}

export function makeContent({ db, FieldValue, now = Date.now }: ContentDeps) {
  const paths = () => db.collection('paths'), presets = () => db.collection('presets'), decks = () => db.collection('decks'), students = () => db.collection('students')
  const access = makeAccess(db)

  return {
    // Преподаватель — всё. Ученик — свой путь и только доступные ему колоды (для всех или назначенные ему); пресетов не видит.
    async list(user: TokenUser): Promise<ContentResponse> {
      if (user.role === 'teacher') {
        const [p, pr, d] = await Promise.all([paths().get(), presets().get(), decks().get()])
        const out: Record<string, PathUnit[]> = {}
        for (const x of p.docs) out[x.id] = (x.get('units') as PathUnit[]) ?? []
        return { paths: out, presets: [...pr.docs].sort(byCreated).map(pubPreset), decks: [...d.docs].sort(byCreated).map(pubDeck) }
      }
      const sid = await access.ownStudentId(user)
      if (!sid) return { paths: {}, presets: [], decks: [] }
      const [p, d] = await Promise.all([paths().doc(sid).get(), decks().get()])
      return {
        paths: { [sid]: p.exists ? (p.get('units') as PathUnit[]) ?? [] : [] }, presets: [],
        decks: [...d.docs].sort(byCreated).map(pubDeck).filter((x) => x.forAll || x.assigned.includes(sid)),
      }
    },

    // Путь ученика целиком (преподаватель)
    async putPath(studentId: string, input: unknown): Promise<void> {
      const sid = id(studentId, 'student id')
      const st = await students().doc(sid).get()
      if (!st.exists || st.get('archived')) throw fail(404, 'student not found')
      const units = cleanUnits((input as { units?: unknown } | undefined)?.units)
      await db.runTransaction(async (tx) => {
        const ref = paths().doc(sid), cur = await tx.get(ref)
        const done = new Set<string>()
        for (const u of (cur.get('units') as PathUnit[] | undefined) ?? []) for (const n of u.nodes) if (n.done) done.add(n.id)
        for (const u of units) for (const n of u.nodes) if (done.has(n.id)) n.done = true       // выполненное не «снимается»
        tx.set(ref, { units, updatedAt: FieldValue.serverTimestamp() })
      })
    },

    // Отметить кружок выполненным и начислить ученику монеты. Преподаватель — любой кружок, ученик — только свой текущий.
    async completeNode(user: TokenUser, studentId: string, nodeId: string): Promise<CompleteResponse> {
      const sid = id(studentId, 'student id'), nid = id(nodeId, 'node id')
      if (user.role === 'student') { if ((await access.ownStudentId(user)) !== sid) throw fail(403, 'forbidden') }
      else if (user.role !== 'teacher') throw fail(403, 'forbidden')
      let coins = 0
      await db.runTransaction(async (tx) => {
        const pRef = paths().doc(sid), sRef = students().doc(sid)
        const p = await tx.get(pRef), s = await tx.get(sRef)
        if (!p.exists || !s.exists || s.get('archived')) throw fail(404, 'not found')
        const units = p.get('units') as PathUnit[]
        const flat = units.flatMap((u) => u.nodes)
        const node = flat.find((n) => n.id === nid)
        if (!node) throw fail(404, 'node not found')
        coins = Number(s.get('coins') ?? 0)
        if (node.done) return                                                        // уже выполнено — монеты второй раз не начисляем
        if (user.role === 'student' && flat.find((n) => !n.done)?.id !== nid) throw fail(409, 'node is locked')
        node.done = true; coins += node.xp
        tx.set(pRef, { units, updatedAt: FieldValue.serverTimestamp() })
        tx.update(sRef, { coins })
      })
      return { coins }
    },

    // Пресеты и колоды: «создать или заменить» по id, который придумывает сайт
    async putPreset(presetId: string, input: unknown, by: string): Promise<void> {
      const pid = id(presetId, 'preset id'), data = cleanPreset(input)
      const ref = presets().doc(pid), cur = await ref.get()
      await ref.set({ ...data, createdBy: cur.get('createdBy') ?? by, createdMs: cur.get('createdMs') ?? now(), updatedAt: FieldValue.serverTimestamp() })
    },
    async removePreset(presetId: string): Promise<void> { await presets().doc(id(presetId, 'preset id')).delete() },

    async putDeck(deckId: string, input: unknown, by: string): Promise<void> {
      const did = id(deckId, 'deck id'), data = cleanDeck(input)
      const ref = decks().doc(did), cur = await ref.get()
      await ref.set({ ...data, createdBy: cur.get('createdBy') ?? by, createdMs: cur.get('createdMs') ?? now(), updatedAt: FieldValue.serverTimestamp() })
    },
    async removeDeck(deckId: string): Promise<void> { await decks().doc(id(deckId, 'deck id')).delete() },
  }
}
