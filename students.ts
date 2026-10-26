// Ученики и приглашения. Сайт НЕ ходит в Firestore напрямую: всё идёт через эти функции на сервере,
// а доступ определяется ролью из проверенного токена. Тест: node students.test.mjs
import crypto from 'node:crypto'
import type { Firestore, FieldValue as FV } from 'firebase-admin/firestore'
import { fail } from './login.js'
import { LEVELS } from './types.js'
import { cleanUsername, isUsername } from './tgphoto.js'
import { addDays } from './schedule.js'
import type { Level, PriceChange, Student, StudentDoc, StudentInput, TokenUser } from './types.js'

export { LEVELS }
const COLORS = ['#ff4b4b', '#1cb0f6', '#ce82ff', '#58cc02', '#ff9600', '#2b70c9', '#ff86d0']
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// Что отдаём на сайт (без служебных полей)
const pub = (id: string, x: StudentDoc): Student => ({
  id, name: x.name, level: x.level, color: x.color, username: x.username || '', streak: x.streak ?? 0, coins: x.coins ?? 0,
  status: x.status || 'invited', tgId: x.tgId ?? null, photoUrl: x.photoUrl || '', price: x.price ?? 0, priceHistory: x.priceHistory ?? [{ from: '', price: x.price ?? 0 }], payment: x.payment,
})

// Цена из запроса: пусто → 0, иначе число 0–100000 с точностью до копеек; остальное — 400
const parsePrice = (raw: unknown): number => {
  const n = raw == null || raw === '' ? 0 : Number(raw)
  if (!Number.isFinite(n) || n < 0 || n > 100000) throw fail(400, 'bad price')
  return Math.round(n * 100) / 100
}
// Ключ «ближайший следующий час» в часовом поясе расписания: 'YYYY-MM-DDTHH'. Новая цена действует для уроков, которые начнутся с него;
// урок текущего часа (уже идёт) и всё прошедшее остаются по старой цене.
export function nextHourKey(tz: string, now: Date): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(now).map((x) => [x.type, x.value]))
  const h = Number(p.hour) + 1, date = `${p.year}-${p.month}-${p.day}`
  return h === 24 ? `${addDays(date, 1)}T00` : `${date}T${String(h).padStart(2, '0')}`
}

export interface StudentsDeps {
  db: Firestore; FieldValue: Pick<typeof FV, 'serverTimestamp'>
  tz?: string; now?: () => Date                                  // часовой пояс расписания и «сейчас» (для тестов)
  photoByUsername?: (username: string) => Promise<string>      // фото по нику из Telegram; не передан — фото не ищем
}

export function makeStudents({ db, FieldValue, photoByUsername, tz = 'Europe/Warsaw', now = () => new Date() }: StudentsDeps) {
  const col = () => db.collection('students')
  const alive = () => col().where('archived', '==', false).get()

  return {
    // Преподаватель — все активные ученики; ученик — только своя запись, и только если она всё ещё привязана к его аккаунту
    async list(user: TokenUser): Promise<Student[]> {
      if (user.role === 'teacher') return (await alive()).docs.map((d) => pub(d.id, d.data() as StudentDoc))
      if (user.role === 'student' && user.studentId) {
        const d = await col().doc(String(user.studentId)).get()
        return d.exists && !d.get('archived') && `tg:${d.get('tgId')}` === user.uid ? [pub(d.id, d.data() as StudentDoc)] : []
      }
      return []
    },

    async create(input: Partial<StudentInput> | undefined, by: string): Promise<Student> {
      const name = String(input?.name ?? '').trim()
      const level = String(input?.level ?? 'A1') as Level
      const pack = Math.min(100, Math.max(1, Math.round(Number(input?.packageSize) || 8)))
      if (!name || name.length > 40) throw fail(400, 'name required (1–40 chars)')
      if (!(LEVELS as readonly string[]).includes(level)) throw fail(400, 'bad level')
      const username = cleanUsername(input?.username)
      if (username && !isUsername(username)) throw fail(400, 'bad username')
      const price = parsePrice(input?.price)
      let photoUrl = ''
      if (username && photoByUsername) { try { photoUrl = await photoByUsername(username) } catch { /* нет сети или Telegram не ответил — просто без фото */ } }
      const week = new Date(); week.setDate(week.getDate() + 7)
      const data: StudentDoc = {
        name, level, color: COLORS[(await alive()).size % COLORS.length], status: 'invited', archived: false, tgId: null, username, photoUrl, price, priceHistory: [{ from: '', price }],
        streak: 0, coins: 0, createdBy: by, createdAt: FieldValue.serverTimestamp(),
        payment: { status: 'due', until: ymd(week), lessonsLeft: 0, packageSize: pack },
      }
      const ref = await col().add(data)
      return pub(ref.id, data)
    },

    // Ник Telegram у уже созданного ученика: ставим ник и заново ищем фото по нему.
    // Пока ученик не открыл приглашение; после входа ник и фото приходят из его настоящего аккаунта.
    async setUsername(id: string, raw: unknown): Promise<Student> {
      if (!/^[\w-]{1,64}$/.test(id)) throw fail(400, 'studentId required')
      const username = cleanUsername(raw)
      if (!isUsername(username)) throw fail(400, 'bad username')
      const ref = col().doc(id), st = await ref.get()
      if (!st.exists || st.get('archived')) throw fail(404, 'student not found')
      if (st.get('tgId')) throw fail(409, 'student already linked to an account')
      let photoUrl = ''
      if (photoByUsername) { try { photoUrl = await photoByUsername(username) } catch { photoUrl = st.get('photoUrl') || '' } }   // сбой поиска — оставляем, что было
      await ref.update({ username, photoUrl })
      return pub(id, { ...(st.data() as StudentDoc), username, photoUrl })
    },

    // Новая цена урока. Действует для уроков, что начнутся со следующего часа; прошедшие уроки остаются по старой цене (см. PriceChange).
    async setPrice(id: string, raw: unknown): Promise<Student> {
      if (!/^[\w-]{1,64}$/.test(id)) throw fail(400, 'studentId required')
      const price = parsePrice(raw)
      const ref = col().doc(id), st = await ref.get()
      if (!st.exists || st.get('archived')) throw fail(404, 'student not found')
      const doc = st.data() as StudentDoc
      const was = doc.price ?? 0
      const history: PriceChange[] = [...(doc.priceHistory ?? [{ from: '', price: was }])]       // у старых записей истории нет: прежняя цена действовала всегда
      if (price !== was || !doc.priceHistory) {
        const from = nextHourKey(tz, now())
        if (price !== was) {
          if (history.at(-1)!.from === from) history[history.length - 1] = { from, price }         // вторая правка в тот же час заменяет первую, прошлое не трогаем
          else history.push({ from, price })
        }
        await ref.update({ price, priceHistory: history.slice(-200) })
      }
      return pub(id, { ...doc, price, priceHistory: history.slice(-200) })
    },

    // Одноразовое приглашение для записи ученика
    async invite(studentId: string, by: string): Promise<string> {
      if (!/^[\w-]{1,64}$/.test(studentId)) throw fail(400, 'studentId required')
      const st = await col().doc(studentId).get()
      if (!st.exists || st.get('archived')) throw fail(404, 'student not found')
      const code = crypto.randomBytes(12).toString('base64url')
      await db.collection('invites').doc(code).set({ studentId, createdBy: by, createdAt: FieldValue.serverTimestamp() })
      return code
    },

    // Архив: скрывает запись, закрывает аккаунту доступ, гасит неиспользованные приглашения
    async archive(id: string): Promise<void> {
      const ref = col().doc(id), st = await ref.get()
      if (!st.exists) throw fail(404, 'student not found')
      const batch = db.batch()
      batch.update(ref, { archived: true, archivedAt: FieldValue.serverTimestamp() })
      if (st.get('tgId')) batch.delete(db.collection('users').doc(`tg:${st.get('tgId')}`))
      for (const d of (await db.collection('invites').where('studentId', '==', id).get()).docs) if (!d.get('usedBy')) batch.delete(d.ref)
      await batch.commit()
    },
  }
}
