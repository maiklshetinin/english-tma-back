// Ученики и приглашения. Сайт НЕ ходит в Firestore напрямую: всё идёт через эти функции на сервере,
// а доступ определяется ролью из проверенного токена. Тест: node students.test.mjs
import crypto from 'node:crypto'
import type { Firestore, FieldValue as FV } from 'firebase-admin/firestore'
import { fail } from './login.js'
import { LEVELS } from './types.js'
import { cleanUsername, isUsername } from './tgphoto.js'
import type { Level, Student, StudentDoc, StudentInput, TokenUser } from './types.js'

export { LEVELS }
const COLORS = ['#ff4b4b', '#1cb0f6', '#ce82ff', '#58cc02', '#ff9600', '#2b70c9', '#ff86d0']
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// Что отдаём на сайт (без служебных полей)
const pub = (id: string, x: StudentDoc): Student => ({
  id, name: x.name, level: x.level, color: x.color, username: x.username || '', streak: x.streak ?? 0, coins: x.coins ?? 0,
  status: x.status || 'invited', tgId: x.tgId ?? null, photoUrl: x.photoUrl || '', price: x.price ?? 0, payment: x.payment,
})

export interface StudentsDeps {
  db: Firestore; FieldValue: Pick<typeof FV, 'serverTimestamp'>
  photoByUsername?: (username: string) => Promise<string>      // фото по нику из Telegram; не передан — фото не ищем
}

export function makeStudents({ db, FieldValue, photoByUsername }: StudentsDeps) {
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
      const rawPrice = input?.price == null || (input.price as unknown) === '' ? 0 : Number(input.price)
      if (!Number.isFinite(rawPrice) || rawPrice < 0 || rawPrice > 100000) throw fail(400, 'bad price')
      const price = Math.round(rawPrice * 100) / 100
      let photoUrl = ''
      if (username && photoByUsername) { try { photoUrl = await photoByUsername(username) } catch { /* нет сети или Telegram не ответил — просто без фото */ } }
      const week = new Date(); week.setDate(week.getDate() + 7)
      const data: StudentDoc = {
        name, level, color: COLORS[(await alive()).size % COLORS.length], status: 'invited', archived: false, tgId: null, username, photoUrl, price,
        streak: 0, coins: 0, createdBy: by, createdAt: FieldValue.serverTimestamp(),
        payment: { status: 'due', until: ymd(week), lessonsLeft: 0, packageSize: pack },
      }
      const ref = await col().add(data)
      return pub(ref.id, data)
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
