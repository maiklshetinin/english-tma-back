// Запуск: npx tsx content.test.ts — путь, пресеты, колоды (без Firebase — база в памяти)
import { store, db, FieldValue } from './fake-db.js'
import { makeContent } from './content.js'
import type { TokenUser } from './types.js'

let clock = 1_000
const C = makeContent({ db, FieldValue, now: () => ++clock })
let bad = 0
const ok = (name: string, c: unknown) => { console.log(c ? 'PASS' : 'FAIL', name); if (!c) bad++ }
const code = async (p: Promise<unknown>) => { try { await p; return 200 } catch (e: any) { return e.status ?? 500 } }
const node = (o: object = {}) => ({ id: 'n1', type: 'hw', title: 'ДЗ', xp: 20, done: false, ...o })
const unit = (nodes: unknown[], o: object = {}) => ({ id: 'u1', title: 'Unit 1', sub: '', nodes, ...o })

const teacher: TokenUser = { uid: 'tg:1', role: 'teacher' }
store.set('students/s1', { name: 'Маша', archived: false, tgId: 10, coins: 5 })
store.set('students/s2', { name: 'Петя', archived: false, tgId: 11, coins: 0 })
store.set('students/old', { name: 'Старый', archived: true, tgId: 12, coins: 0 })
const masha: TokenUser = { uid: 'tg:10', role: 'student', studentId: 's1' }
const petya: TokenUser = { uid: 'tg:11', role: 'student', studentId: 's2' }
const stray: TokenUser = { uid: 'tg:99', role: 'student', studentId: 's1' }      // чужой аккаунт с чужим studentId
const gone: TokenUser = { uid: 'tg:12', role: 'student', studentId: 'old' }

// --- путь: запись преподавателем ---
ok('путь несуществующего ученика → 404', (await code(C.putPath('nope', { units: [] }))) === 404)
ok('путь архивного ученика → 404', (await code(C.putPath('old', { units: [] }))) === 404)
ok('путь с мусором → 400', (await code(C.putPath('s1', { units: [unit([node({ type: 'x' })])] }))) === 400)
await C.putPath('s1', { units: [unit([node({ id: 'a' }), node({ id: 'b', xp: 30 }), node({ id: 'c', type: 'cards', deckId: 'd1' })])] })
ok('путь сохранён', store.get('paths/s1').units[0].nodes.length === 3 && store.get('paths/s1').units[0].nodes[2].deckId === 'd1')
ok('чужое поле отрезано, служебное время записано', !('evil' in store.get('paths/s1').units[0]) && store.get('paths/s1').updatedAt !== undefined)

// --- выполнение кружков ---
ok('ученик не может отметить НЕ текущий кружок → 409', (await code(C.completeNode(masha, 's1', 'b'))) === 409)
const r1 = await C.completeNode(masha, 's1', 'a')
ok('ученик отметил текущий: монеты начислены (5 + 20)', r1.coins === 25 && store.get('students/s1').coins === 25 && store.get('paths/s1').units[0].nodes[0].done === true)
const r2 = await C.completeNode(masha, 's1', 'a')
ok('повторная отметка монет не добавляет', r2.coins === 25 && store.get('students/s1').coins === 25)
const r3 = await C.completeNode(masha, 's1', 'b')
ok('следующий кружок стал текущим', r3.coins === 55)
ok('чужой ученик → 403', (await code(C.completeNode(petya, 's1', 'c'))) === 403)
ok('чужой аккаунт с чужим studentId → 403', (await code(C.completeNode(stray, 's1', 'c'))) === 403)
ok('архивный ученик → 403', (await code(C.completeNode(gone, 'old', 'c'))) === 403)
ok('несуществующий кружок → 404', (await code(C.completeNode(masha, 's1', 'zzz'))) === 404)
const r4 = await C.completeNode(teacher, 's1', 'c')
ok('преподаватель отмечает любой кружок', r4.coins === 75 && store.get('paths/s1').units[0].nodes[2].done === true)
ok('у ученика без пути → 404', (await code(C.completeNode(petya, 's2', 'a'))) === 404)

// --- «выполненное не снимается» ---
await C.putPath('s1', { units: [unit([node({ id: 'a', title: 'Переименовано' }), node({ id: 'b' }), node({ id: 'c', type: 'cards' }), node({ id: 'd' })])] })
const after = store.get('paths/s1').units[0].nodes
ok('преподаватель сохранил старую версию (done: false) — отметки ученика не потеряны', after[0].done && after[1].done && after[2].done && !after[3].done)
ok('правки названия при этом применились', after[0].title === 'Переименовано')

// --- пресеты ---
ok('пресет без имени → 400', (await code(C.putPreset('p1', { name: '', units: [] }, 'tg:1'))) === 400)
ok('плохой id пресета → 400', (await code(C.putPreset('a/b', { name: 'X', units: [] }, 'tg:1'))) === 400)
await C.putPreset('p1', { name: 'Базовый', units: [unit([node()])] }, 'tg:1')
await C.putPreset('p2', { name: 'Разговорный', units: [] }, 'tg:1')
const created = store.get('presets/p1').createdMs
await C.putPreset('p1', { name: 'Базовый курс', units: [] }, 'tg:2')
ok('обновление пресета не меняет автора и порядок', store.get('presets/p1').createdMs === created && store.get('presets/p1').createdBy === 'tg:1' && store.get('presets/p1').name === 'Базовый курс')

// --- колоды ---
const card = (o: object = {}) => ({ id: 'c1', front: 'deadline', back: 'срок', ...o })
const deck = (o: object = {}) => ({ title: 'Business', forAll: false, assigned: [], newPerDay: 20, source: { url: '', lastSync: null }, cards: [card()], ...o })
await C.putDeck('d1', deck({ forAll: true }), 'tg:1')
await C.putDeck('d2', deck({ title: 'Travel', assigned: ['s1'] }), 'tg:1')
await C.putDeck('d3', deck({ title: 'Phrasal', assigned: ['s2'] }), 'tg:1')
ok('колода с мусором → 400', (await code(C.putDeck('d9', deck({ cards: [{ id: 'x' }] }), 'tg:1'))) === 400)

// --- чтение: преподаватель ---
const t = await C.list(teacher)
ok('преподаватель: пути, пресеты и колоды', Object.keys(t.paths).includes('s1') && t.presets.length === 2 && t.decks.length === 3)
ok('порядок по времени создания', t.presets.map(p => p.id).join() === 'p1,p2' && t.decks.map(d => d.id).join() === 'd1,d2,d3')
ok('в ответе нет служебных полей', !('createdBy' in t.decks[0]) && !('updatedAt' in t.presets[0]))

// --- чтение: ученик ---
const m = await C.list(masha)
ok('ученик: только свой путь', Object.keys(m.paths).join() === 's1')
ok('ученик: колоды «для всех» и назначенные ему, чужих нет', m.decks.map(d => d.id).join() === 'd1,d2')
ok('ученик: пресетов не видит', m.presets.length === 0)
const p2 = await C.list(petya)
ok('ученик без пути: пустой путь, свои колоды', p2.paths.s2.length === 0 && p2.decks.map(d => d.id).join() === 'd1,d3')
ok('чужой аккаунт с чужим studentId — пусто', (await C.list(stray)).decks.length === 0 && Object.keys((await C.list(stray)).paths).length === 0)
ok('архивный ученик — пусто', (await C.list(gone)).decks.length === 0)

// --- удаление ---
await C.removeDeck('d2'); await C.removePreset('p2')
ok('колода и пресет удалены', !store.has('decks/d2') && !store.has('presets/p2'))
ok('удаление несуществующего не падает', (await code(C.removeDeck('nope'))) === 200)

process.exit(bad ? 1 : 0)
