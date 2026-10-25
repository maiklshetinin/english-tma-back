// Сервер для Render: проверяет вход через Telegram, выдаёт Firebase-токен, создаёт приглашения для учеников.
// Переменные окружения — в server/README.md.
import express from 'express'
import cors from 'cors'
import crypto from 'node:crypto'
import { initializeApp, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { verifyInitData, verifyWidget } from './telegram.js'

const env = process.env
const { BOT_TOKEN, BOT_USERNAME, APP_SHORT_NAME } = env
if (!BOT_TOKEN || !BOT_USERNAME || !env.FIREBASE_SERVICE_ACCOUNT) throw new Error('Задайте BOT_TOKEN, BOT_USERNAME и FIREBASE_SERVICE_ACCOUNT')
const list = (v) => (v || '').split(',').map(s => s.trim()).filter(Boolean)
const TEACHER_IDS = list(env.TEACHER_IDS)               // Telegram id преподавателей (число, не @username — ник можно сменить)

initializeApp({ credential: cert(JSON.parse(env.FIREBASE_SERVICE_ACCOUNT)) })
const auth = getAuth(), db = getFirestore()

const app = express()
app.use(cors({ origin: list(env.ALLOWED_ORIGIN) }), express.json({ limit: '10kb' }))
app.get('/', (_, res) => res.send('ok'))                  // для проверки Render и «будилки»

const wrap = (fn) => (req, res) => fn(req, res).catch(e => { console.error(e); res.status(e.status || 500).json({ error: e.message || 'error' }) })
const fail = (status, message) => Object.assign(new Error(message), { status })

// Вход: ищем пользователя; преподаватель — по TEACHER_IDS; ученик — только по одноразовому приглашению
async function login({ user: u, startParam }) {
  const uid = `tg:${u.id}`, ref = db.collection('users').doc(uid)
  const code = /^invite_([\w-]{8,64})$/.exec(startParam)?.[1]
  const profile = { tgId: u.id, name: u.first_name || '', username: u.username || '', photoUrl: u.photo_url || '', lastLoginAt: FieldValue.serverTimestamp() }
  let role = null, studentId = null
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const inv = !snap.exists && code ? await tx.get(db.collection('invites').doc(code)) : null
    if (TEACHER_IDS.includes(String(u.id))) { role = 'teacher'; tx.set(ref, { ...profile, role }, { merge: true }) }
    else if (snap.exists) { role = snap.get('role'); studentId = snap.get('studentId') ?? null; tx.update(ref, profile) }
    else if (inv?.exists && !inv.get('usedBy')) {
      role = 'student'; studentId = inv.get('studentId')
      tx.update(inv.ref, { usedBy: uid, usedAt: FieldValue.serverTimestamp() })
      tx.set(ref, { ...profile, role, studentId, createdAt: FieldValue.serverTimestamp() })
    }
  })
  if (!role) throw fail(403, 'no access')
  // Данные профиля кладём в токен, чтобы фронту не нужен был отдельный запрос (лимит клеймов — 1000 байт)
  const token = await auth.createCustomToken(uid, { role, studentId, tgName: profile.name, tgUsername: profile.username, tgPhoto: profile.photoUrl })
  return { token }
}

app.post('/auth/telegram', wrap(async (req, res) => {
  const v = verifyInitData((req.headers.authorization || '').replace(/^tma /, ''), BOT_TOKEN)
  if (!v) throw fail(401, 'bad signature')
  res.json(await login(v))
}))
app.post('/auth/telegram-widget', wrap(async (req, res) => {
  const v = verifyWidget(req.body, BOT_TOKEN)
  if (!v) throw fail(401, 'bad signature')
  res.json(await login(v))
}))

// Дальше — запросы с Firebase ID-токеном (Authorization: Bearer …)
const requireUser = async (req, res, next) => {
  try { req.user = await auth.verifyIdToken((req.headers.authorization || '').replace(/^Bearer /, '')); next() }
  catch { res.status(401).json({ error: 'unauthorized' }) }
}
const requireTeacher = (req, res, next) => (req.user.role === 'teacher' ? next() : res.status(403).json({ error: 'teacher only' }))

// Ссылка-приглашение для ученика: открыв её, он привяжется к записи studentId
app.post('/invites', requireUser, requireTeacher, wrap(async (req, res) => {
  const studentId = Number(req.body?.studentId)
  if (!Number.isInteger(studentId)) throw fail(400, 'studentId required')
  const code = crypto.randomBytes(12).toString('base64url')
  await db.collection('invites').doc(code).set({ studentId, createdBy: req.user.uid, createdAt: FieldValue.serverTimestamp() })
  const base = APP_SHORT_NAME ? `https://t.me/${BOT_USERNAME}/${APP_SHORT_NAME}` : `https://t.me/${BOT_USERNAME}`
  res.json({ url: `${base}?startapp=invite_${code}` })
}))

// Аватарка пользователя через Bot API (Mini App отдаёт фото только самого пользователя). Токен бота наружу не уходит.
const tgApi = (m, q) => fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${m}?${new URLSearchParams(q)}`).then(r => r.json())
app.get('/avatar/:tgId', requireUser, wrap(async (req, res) => {
  const id = Number(req.params.tgId)
  if (req.user.role !== 'teacher' && req.user.uid !== `tg:${id}`) throw fail(403, 'forbidden')
  if (!(await db.collection('users').doc(`tg:${id}`).get()).exists) throw fail(404, 'unknown user')
  const sizes = (await tgApi('getUserProfilePhotos', { user_id: id, limit: 1 })).result?.photos?.[0]
  if (!sizes) throw fail(404, 'no photo')
  const file = await tgApi('getFile', { file_id: sizes[0].file_id })
  const img = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${file.result.file_path}`)
  res.set('Content-Type', img.headers.get('content-type') || 'image/jpeg').set('Cache-Control', 'private, max-age=86400')
  res.send(Buffer.from(await img.arrayBuffer()))
}))

// Google Таблица → CSV (таблица должна быть открыта «по ссылке»). Адрес собираем сами из id, чужие URL не ходят.
app.get('/sheets/csv', requireUser, requireTeacher, wrap(async (req, res) => {
  const m = String(req.query.url || '').match(/\/spreadsheets\/d\/([\w-]+)/)
  if (!m) throw fail(400, 'not a sheet url')
  const gid = (String(req.query.url).match(/[#&?]gid=(\d+)/) || [])[1]
  const r = await fetch(`https://docs.google.com/spreadsheets/d/${m[1]}/gviz/tq?tqx=out:csv${gid ? `&gid=${gid}` : ''}`)
  if (!r.ok) throw fail(r.status === 404 ? 404 : 403, 'sheet unavailable')
  res.type('text/csv').send(await r.text())
}))

app.listen(env.PORT || 3000, () => console.log('server up'))
