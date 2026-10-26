// Прогресс повторений слов (интервальные повторения). Документ srs/<пользователь>: состояние каждой карточки и журнал «сколько ответов в день».
// Состояние карточки считает сайт (упрощённый SM-2), сервер проверяет его форму и пишет в документ ТОЛЬКО самого пользователя —
// ученик не может изменить чужой прогресс. Преподаватель видит прогресс всех учеников и свой собственный (под ключом 'teacher').
import type { Firestore, FieldValue as FV } from 'firebase-admin/firestore'
import { fail } from './login.js'
import { makeAccess } from './access.js'
import { LIMITS, cleanRate } from './clean.js'
import type { SrsResponse, SrsUser, TokenUser } from './types.js'

export interface SrsDeps { db: Firestore; FieldValue: Pick<typeof FV, 'serverTimestamp'>; now?: () => number }

const DAY = 86_400_000
const LOG_DAYS = 90                                   // журнал старше 90 дней не храним

export function makeSrs({ db, FieldValue, now = Date.now }: SrsDeps) {
  const col = () => db.collection('srs')
  const access = makeAccess(db)
  const mine = async (user: TokenUser): Promise<string> => {
    if (user.role === 'teacher') return `teacher_${user.uid}`
    const sid = await access.ownStudentId(user)
    if (!sid) throw fail(403, 'forbidden')
    return sid
  }
  const pub = (x: Partial<SrsUser> | undefined): SrsUser => ({ cards: x?.cards ?? {}, log: x?.log ?? {} })

  return {
    async list(user: TokenUser): Promise<SrsResponse> {
      const users: Record<string, SrsUser> = {}
      if (user.role === 'teacher') {
        for (const d of (await col().get()).docs) {
          if (!d.id.startsWith('teacher_')) users[d.id] = pub(d.data())
          else if (d.id === `teacher_${user.uid}`) users.teacher = pub(d.data())          // чужой прогресс других преподавателей не отдаём
        }
        return { users }
      }
      const sid = await access.ownStudentId(user)
      if (sid) users[sid] = pub((await col().doc(sid).get()).data())
      return { users }
    },

    // Один ответ на карточку (или его отмена): новое состояние карточки и +1 / −1 к счётчику дня
    async rate(user: TokenUser, input: unknown): Promise<void> {
      const r = cleanRate(input), docId = await mine(user)
      if (Math.abs(Date.parse(r.date) - now()) > 2.5 * DAY) throw fail(400, 'bad date')       // «сегодня» у пользователя — в пределах пары суток от серверного
      await db.runTransaction(async (tx) => {
        const ref = col().doc(docId), cur = pub((await tx.get(ref)).data())
        const cards = { ...cur.cards }, log = { ...cur.log }
        if (r.state) cards[r.cardId] = r.state; else delete cards[r.cardId]
        if (Object.keys(cards).length > LIMITS.cardsTotal) throw fail(413, 'too many cards')
        log[r.date] = Math.max(0, (log[r.date] ?? 0) + r.delta)
        const cutoff = new Date(Date.parse(r.date) - LOG_DAYS * DAY).toISOString().slice(0, 10)
        for (const k of Object.keys(log)) if (k < cutoff) delete log[k]
        tx.set(ref, { cards, log, updatedAt: FieldValue.serverTimestamp() })
      })
    },
  }
}
