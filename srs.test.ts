// Запуск: npx tsx srs.test.ts — прогресс повторений (без Firebase — база в памяти)
import { store, db, FieldValue } from './fake-db.js'
import { makeSrs } from './srs.js'
import type { TokenUser } from './types.js'

const NOW = Date.parse('2026-10-26T10:00:00Z')
const S = makeSrs({ db, FieldValue, now: () => NOW })
let bad = 0
const ok = (name: string, c: unknown) => { console.log(c ? 'PASS' : 'FAIL', name); if (!c) bad++ }
const code = async (p: Promise<unknown>) => { try { await p; return 200 } catch (e: any) { return e.status ?? 500 } }
const st = (o: object = {}) => ({ ease: 2.5, interval: 1, reps: 1, lapses: 0, first: '2026-10-26', last: '2026-10-26', due: '2026-10-27', ...o })
const rate = (cardId: string, state: unknown, delta: 1 | -1 = 1, date = '2026-10-26') => ({ cardId, state, date, delta })

store.set('students/s1', { name: 'Маша', archived: false, tgId: 10 })
store.set('students/s2', { name: 'Петя', archived: false, tgId: 11 })
const teacher: TokenUser = { uid: 'tg:1', role: 'teacher' }
const teacher2: TokenUser = { uid: 'tg:2', role: 'teacher' }
const masha: TokenUser = { uid: 'tg:10', role: 'student', studentId: 's1' }
const petya: TokenUser = { uid: 'tg:11', role: 'student', studentId: 's2' }
const stray: TokenUser = { uid: 'tg:99', role: 'student', studentId: 's1' }

// --- запись ---
await S.rate(masha, rate('c1', st()))
ok('ответ ученика: состояние карточки и счётчик дня', store.get('srs/s1').cards.c1.interval === 1 && store.get('srs/s1').log['2026-10-26'] === 1)
await S.rate(masha, rate('c2', st({ interval: 3, due: '2026-10-29' })))
await S.rate(masha, rate('c1', st({ interval: 3, reps: 2, due: '2026-10-29' })))
ok('несколько ответов копятся: 3 за день, карточек 2', store.get('srs/s1').log['2026-10-26'] === 3 && Object.keys(store.get('srs/s1').cards).length === 2)
await S.rate(masha, rate('c1', st(), -1))
ok('отмена: состояние возвращено, счётчик −1', store.get('srs/s1').cards.c1.interval === 1 && store.get('srs/s1').log['2026-10-26'] === 2)
await S.rate(masha, rate('c2', null, -1))
ok('отмена первого ответа: карточка снова «новая»', !('c2' in store.get('srs/s1').cards) && store.get('srs/s1').log['2026-10-26'] === 1)
await S.rate(masha, rate('c3', null, -1))
ok('счётчик дня не уходит ниже нуля', store.get('srs/s1').log['2026-10-26'] === 0)

ok('пишет только в свой документ: у Пети ничего нет', !store.has('srs/s2'))
await S.rate(petya, rate('c1', st()))
ok('у Пети свой документ, у Маши прогресс не тронут', store.get('srs/s2').cards.c1.interval === 1 && store.get('srs/s1').cards.c1.interval === 1)
await S.rate(teacher, rate('c1', st({ interval: 9 })))
ok('преподаватель пишет в свой документ', store.get('srs/teacher_tg:1').cards.c1.interval === 9)
ok('чужой аккаунт с чужим studentId → 403', (await code(S.rate(stray, rate('c1', st())))) === 403)

// --- проверки ---
ok('плохое состояние → 400', (await code(S.rate(masha, rate('c1', { ease: 'x' })))) === 400)
ok('delta не ±1 → 400', (await code(S.rate(masha, { cardId: 'c1', state: null, date: '2026-10-26', delta: 7 }))) === 400)
ok('дата далеко от сегодняшней → 400', (await code(S.rate(masha, rate('c1', st(), 1, '2026-09-01')))) === 400)
ok('плохой id карточки → 400', (await code(S.rate(masha, rate('a/b', st())))) === 400)

// --- журнал не растёт бесконечно ---
store.set('srs/s2', { cards: {}, log: { '2026-01-01': 5, '2026-10-20': 2 } })
await S.rate(petya, rate('c9', st()))
ok('записи журнала старше 90 дней удаляются, свежие остаются', !('2026-01-01' in store.get('srs/s2').log) && store.get('srs/s2').log['2026-10-20'] === 2)

// --- чтение ---
const t = await S.list(teacher)
ok('преподаватель: все ученики и свой прогресс под ключом teacher', t.users.s1 && t.users.s2 && t.users.teacher.cards.c1.interval === 9)
const t2 = await S.list(teacher2)
ok('другой преподаватель не видит чужой прогресс преподавателя', !('teacher_tg:1' in t.users) && !('teacher_tg:1' in t2.users) && !('teacher' in t2.users) && Object.keys(t2.users).includes('s1'))
const m = await S.list(masha)
ok('ученик: только свой прогресс', Object.keys(m.users).join() === 's1')
ok('чужой аккаунт — пусто', Object.keys((await S.list(stray)).users).length === 0)
store.set('students/s3', { name: 'Новый', archived: false, tgId: 12 })
const fresh = await S.list({ uid: 'tg:12', role: 'student', studentId: 's3' })
ok('ученик без документа: пустой прогресс, не ошибка', Object.keys(fresh.users.s3.cards).length === 0 && Object.keys(fresh.users.s3.log).length === 0)

process.exit(bad ? 1 : 0)
