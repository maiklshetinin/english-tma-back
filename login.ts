// Вход пользователя. Вынесено из index.js, чтобы логику ролей можно было проверять тестами (server/login.test.mjs).
//  • преподаватель — Telegram id есть в TEACHER_IDS;
//  • ученик — уже есть в базе (users/tg:<id>) либо открыл одноразовую ссылку-приглашение на запись students/<id>;
//  • остальным — 403.
import type { Auth } from 'firebase-admin/auth'
import type { Firestore, FieldValue as FV } from 'firebase-admin/firestore'
import type { Verified } from './telegram.js'
import type { AuthResponse, SessionClaims, UserDoc } from './types.js'

export { fail } from './errors.js'
export type { HttpError } from './errors.js'
import { fail } from './errors.js'

export interface LoginDeps { db: Firestore; auth: Pick<Auth, 'createCustomToken'>; FieldValue: Pick<typeof FV, 'serverTimestamp'>; teacherIds: string[] }

export function makeLogin({ db, auth, FieldValue, teacherIds }: LoginDeps) {
  return async function login({ user: u, startParam }: Verified): Promise<AuthResponse> {
    const uid = `tg:${u.id}`, ref = db.collection('users').doc(uid)
    const code = /^invite_([\w-]{8,64})$/.exec(startParam)?.[1]
    const ts = FieldValue.serverTimestamp()
    const profile = { tgId: u.id, name: u.first_name || '', username: u.username || '', photoUrl: u.photo_url || '', lastLoginAt: ts }
    let role: UserDoc['role'] | null = null, studentId: string | null = null
    await db.runTransaction(async (tx) => {
      role = null; studentId = null                       // транзакция может выполниться повторно
      // Сначала все чтения, потом записи (требование Firestore)
      const snap = await tx.get(ref)
      const inv = !snap.exists && code ? await tx.get(db.collection('invites').doc(code)) : null
      const useInvite = !!inv?.exists && !inv.get('usedBy')
      const sid = snap.exists ? snap.get('studentId') : useInvite ? inv.get('studentId') : null
      const stRef = sid != null ? db.collection('students').doc(String(sid)) : null
      const st = stRef ? await tx.get(stRef) : null
      const alive = !!st?.exists && !st.get('archived')   // запись ученика есть и не в архиве

      if (teacherIds.includes(String(u.id))) {
        role = 'teacher'; tx.set(ref, { ...profile, role }, { merge: true })
      } else if (snap.exists) {
        const r = snap.get('role')
        if (r === 'student' && !alive) return             // ученика архивировали — вход закрыт
        role = r; studentId = snap.get('studentId') ?? null
        tx.update(ref, profile)
        if (r === 'student') tx.update(stRef!, { photoUrl: profile.photoUrl, username: profile.username, lastLoginAt: ts })
      } else if (useInvite && alive) {
        role = 'student'; studentId = String(sid)
        const old = st.get('tgId')                         // запись уже была привязана к другому аккаунту → старый теряет доступ
        if (old && old !== u.id) tx.delete(db.collection('users').doc(`tg:${old}`))
        tx.update(inv.ref, { usedBy: uid, usedAt: ts })
        tx.update(stRef!, { tgId: u.id, status: 'active', photoUrl: profile.photoUrl, username: profile.username, joinedAt: ts })
        tx.set(ref, { ...profile, role, studentId, createdAt: ts })
      }
    })
    if (!role) throw fail(403, 'no access')
    console.log(`  → вход: tg:${u.id} @${u.username || '-'} как ${role}`)
    // Данные профиля кладём в токен, чтобы фронту не нужен был отдельный запрос (лимит клеймов — 1000 байт)
    const token = await auth.createCustomToken(uid, { role, studentId, tgName: profile.name, tgUsername: profile.username, tgPhoto: profile.photoUrl } satisfies SessionClaims)
    return { token }
  }
}
