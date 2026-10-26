// Сервер для Render: проверяет вход через Telegram, выдаёт Firebase-токен, создаёт приглашения для учеников.
// Переменные окружения — в server/README.md.
import express from 'express'
import type { NextFunction, Request, RequestHandler, Response } from 'express'
import cors from 'cors'
import { initializeApp, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { verifyInitData, verifyWidget } from './telegram.js'
import { makeLogin, fail } from './login.js'
import { makeStudents } from './students.js'
import { photoByUsername } from './tgphoto.js'
import { makeSchedule } from './schedule.js'
import { makeContent } from './content.js'
import { makeSrs } from './srs.js'
import type { CreateStudentResponse, InviteResponse, PingResponse, TokenUser } from './types.js'

// Пользователь из проверенного Firebase-токена кладётся в req.user (см. requireUser)
declare module 'express-serve-static-core' { interface Request { user: TokenUser } }

const env = process.env
const { BOT_TOKEN, BOT_USERNAME, APP_SHORT_NAME } = env
if (!BOT_TOKEN || !BOT_USERNAME || !env.FIREBASE_SERVICE_ACCOUNT) throw new Error('Задайте BOT_TOKEN, BOT_USERNAME и FIREBASE_SERVICE_ACCOUNT')
const list = (v: string | undefined) => (v || '').split(',').map(s => s.trim()).filter(Boolean)
const TEACHER_IDS = list(env.TEACHER_IDS)               // Telegram id преподавателей (число, не @username — ник можно сменить)

initializeApp({ credential: cert(JSON.parse(env.FIREBASE_SERVICE_ACCOUNT)) })
const auth = getAuth(), db = getFirestore()

const app = express()
const small = express.json({ limit: '10kb' }), big = express.json({ limit: '1mb' })            // путь, пресеты и колоды с карточками — крупнее обычных запросов
app.use(cors({ origin: list(env.ALLOWED_ORIGIN) }), (req, res, next) => (/^\/(paths|presets|decks)\//.test(req.path) ? big : small)(req, res, next))
app.use((req, res, next) => {                              // строка в логах на каждый запрос: метод, путь, код ответа, время
  const t = Date.now()
  res.on('finish', () => req.path !== '/' && console.log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - t}ms`))
  next()
})
app.get('/', (_, res) => res.send('ok'))                  // для проверки Render и «будилки»

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler => (req, res) => {
  fn(req, res).catch((e) => { e.status < 500 ? console.log(`  → ${e.status} ${e.message}`) : console.error(e); res.status(e.status || 500).json({ error: e.message || 'error' }) })
}
const login = makeLogin({ db, auth, FieldValue, teacherIds: TEACHER_IDS })
const students = makeStudents({ db, FieldValue, photoByUsername, tz: env.SCHEDULE_TZ || 'Europe/Warsaw' })
const content = makeContent({ db, FieldValue })
const srs = makeSrs({ db, FieldValue })
const schedule = makeSchedule({ db, FieldValue, tz: env.SCHEDULE_TZ || 'Europe/Warsaw' })      // часовой пояс, по которому считаются «эта» и «следующая» неделя

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

// Проверка связи (кнопка в «Профиле»): пишет строку в логи Render и отвечает, кого узнал по токену
app.post('/ping', wrap(async (req, res) => {
  let who = 'аноним (токена нет или он недействителен)'
  try { const u = await auth.verifyIdToken((req.headers.authorization || '').replace(/^Bearer /, '')); who = `${u.uid} (${u.role})` } catch { /* остаётся аноним */ }
  console.log(`  → PING от ${who}: ${String(req.body?.msg || '').slice(0, 100)}`)
  res.json({ ok: true, who } satisfies PingResponse)
}))

// Дальше — запросы с Firebase ID-токеном (Authorization: Bearer …)
const requireUser = async (req: Request, res: Response, next: NextFunction) => {
  try { req.user = await auth.verifyIdToken((req.headers.authorization || '').replace(/^Bearer /, '')); next() }
  catch { res.status(401).json({ error: 'unauthorized' }) }
}
const requireTeacher = (req: Request, res: Response, next: NextFunction) => (req.user.role === 'teacher' ? next() : res.status(403).json({ error: 'teacher only' }))

// Ученики. Сайт не ходит в Firestore напрямую — только через эти маршруты; доступ определяется ролью в токене.
const inviteUrl = (code: string) => `${APP_SHORT_NAME ? `https://t.me/${BOT_USERNAME}/${APP_SHORT_NAME}` : `https://t.me/${BOT_USERNAME}`}?startapp=invite_${code}`
app.get('/students', requireUser, wrap(async (req, res) => res.json(await students.list(req.user))))      // преподаватель — все, ученик — только он сам
app.post('/students', requireUser, requireTeacher, wrap(async (req, res) => {                              // добавить ученика + сразу ссылка-приглашение
  const student = await students.create(req.body, req.user.uid)
  res.json({ student, url: inviteUrl(await students.invite(student.id, req.user.uid)) } satisfies CreateStudentResponse)
}))
app.post('/invites', requireUser, requireTeacher, wrap(async (req, res) => {                               // новая ссылка для существующего ученика (одноразовая)
  res.json({ url: inviteUrl(await students.invite(String(req.body?.studentId || ''), req.user.uid)) } satisfies InviteResponse)
}))
app.post('/students/:id/username', requireUser, requireTeacher, wrap(async (req, res) => res.json(await students.setUsername(req.params.id, req.body?.username))))   // { username } → обновлённый ученик (с фото по нику)
app.post('/students/:id/price', requireUser, requireTeacher, wrap(async (req, res) => res.json(await students.setPrice(req.params.id, req.body?.price))))   // { price } → обновлённый ученик; прошедшие уроки по старой цене
app.post('/students/:id/archive', requireUser, requireTeacher, wrap(async (req, res) => {                  // архив: скрыть, закрыть доступ, погасить приглашения
  await students.archive(req.params.id)
  await schedule.dropStudent(req.params.id)                                                                 // и убрать из уроков текущей/следующей недели
  console.log(`  → архив: ученик ${req.params.id}`)
  res.json({ ok: true })
}))

// Расписание: две живые недели (текущая и следующая) и уроки в слотах. Урок = сущность с массивом учеников (группа — несколько).
app.get('/schedule', requireUser, wrap(async (req, res) => res.json(await schedule.list(req.user))))      // преподаватель — всё, ученик — только свои уроки
app.post('/lessons', requireUser, requireTeacher, wrap(async (req, res) => res.json(await schedule.create(req.body, req.user.uid))))   // { studentId | studentIds, date, hour }
app.post('/lessons/swap', requireUser, requireTeacher, wrap(async (req, res) => { await schedule.swap(String(req.body?.a || ''), String(req.body?.b || '')); res.json({ ok: true }) }))
app.post('/lessons/:id/move', requireUser, requireTeacher, wrap(async (req, res) => res.json(await schedule.move(req.params.id, req.body))))   // { date, hour }
app.delete('/lessons/:id', requireUser, requireTeacher, wrap(async (req, res) => { await schedule.remove(req.params.id); res.json({ ok: true }) }))

// Путь, пресеты, колоды (content.ts) и прогресс повторений (srs.ts). Сайт правит их целиком, сервер проверяет форму и роль.
app.get('/content', requireUser, wrap(async (req, res) => res.json(await content.list(req.user))))      // преподаватель — всё, ученик — свой путь и доступные колоды
app.put('/paths/:studentId', requireUser, requireTeacher, wrap(async (req, res) => { await content.putPath(req.params.studentId, req.body); res.json({ ok: true }) }))
app.post('/paths/:studentId/complete', requireUser, wrap(async (req, res) => res.json(await content.completeNode(req.user, req.params.studentId, String(req.body?.nodeId || '')))))   // { nodeId } → { coins }
app.put('/presets/:id', requireUser, requireTeacher, wrap(async (req, res) => { await content.putPreset(req.params.id, req.body, req.user.uid); res.json({ ok: true }) }))
app.delete('/presets/:id', requireUser, requireTeacher, wrap(async (req, res) => { await content.removePreset(req.params.id); res.json({ ok: true }) }))
app.put('/decks/:id', requireUser, requireTeacher, wrap(async (req, res) => { await content.putDeck(req.params.id, req.body, req.user.uid); res.json({ ok: true }) }))
app.delete('/decks/:id', requireUser, requireTeacher, wrap(async (req, res) => { await content.removeDeck(req.params.id); res.json({ ok: true }) }))
app.get('/srs', requireUser, wrap(async (req, res) => res.json(await srs.list(req.user))))              // свой прогресс (преподаватель — ещё и всех учеников)
app.post('/srs/rate', requireUser, wrap(async (req, res) => { await srs.rate(req.user, req.body); res.json({ ok: true }) }))

// Аватарка пользователя через Bot API (Mini App отдаёт фото только самого пользователя). Токен бота наружу не уходит.
const tgApi = (m: string, q: Record<string, string>) => fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${m}?${new URLSearchParams(q)}`).then((r) => r.json() as Promise<any>)
app.get('/avatar/:tgId', requireUser, wrap(async (req, res) => {
  const id = Number(req.params.tgId)
  if (req.user.role !== 'teacher' && req.user.uid !== `tg:${id}`) throw fail(403, 'forbidden')
  if (!(await db.collection('users').doc(`tg:${id}`).get()).exists) throw fail(404, 'unknown user')
  const sizes = (await tgApi('getUserProfilePhotos', { user_id: String(id), limit: '1' })).result?.photos?.[0]
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
