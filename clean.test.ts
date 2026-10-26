// Запуск: npx tsx clean.test.ts — проверка входных данных (без Firebase)
import { LIMITS, cleanDeck, cleanPreset, cleanRate, cleanSrsState, cleanUnits } from './clean.js'

let bad = 0
const ok = (name: string, c: unknown) => { console.log(c ? 'PASS' : 'FAIL', name); if (!c) bad++ }
const code = (f: () => unknown) => { try { f(); return 200 } catch (e: any) { return e.status ?? 500 } }
const node = (o: object = {}) => ({ id: 'n1', type: 'hw', title: 'ДЗ', xp: 20, done: false, ...o })
const unit = (nodes: unknown[] = [node()], o: object = {}) => ({ id: 'u1', title: 'Unit 1', sub: '', nodes, ...o })

// --- путь ---
ok('юнит и кружок проходят, лишние поля отрезаются', (() => { const u = cleanUnits([unit([node({ evil: 1, desc: '  Сделай  ' })])]); return u[0].nodes[0].desc === 'Сделай' && !('evil' in u[0].nodes[0]) })())
ok('необязательные поля не появляются из воздуха', (() => { const n = cleanUnits([unit()])[0].nodes[0]; return !('desc' in n) && !('date' in n) && !('time' in n) && !('deckId' in n) })())
ok('дата, время и колода сохраняются', (() => { const n = cleanUnits([unit([node({ type: 'tutor', date: '2026-10-27', time: '09:00', deckId: 'd1' })])])[0].nodes[0]; return n.date === '2026-10-27' && n.time === '09:00' && n.deckId === 'd1' })())
ok('не список → 400', code(() => cleanUnits({})) === 400)
ok('неизвестный тип кружка → 400', code(() => cleanUnits([unit([node({ type: 'magic' })])])) === 400)
ok('пустое название кружка → 400', code(() => cleanUnits([unit([node({ title: '  ' })])])) === 400)
ok('плохая дата → 400', code(() => cleanUnits([unit([node({ date: '27.10.2026' })])])) === 400)
ok('плохое время → 400', code(() => cleanUnits([unit([node({ time: '9am' })])])) === 400)
ok('id с пробелом или слэшем → 400', code(() => cleanUnits([unit([node({ id: 'a/b' })])])) === 400 && code(() => cleanUnits([unit([node({ id: 'a b' })])])) === 400)
ok('одинаковые id кружков → 400', code(() => cleanUnits([unit([node(), node()])])) === 400)
ok('одинаковые id юнитов → 400', code(() => cleanUnits([unit(), unit()])) === 400)
ok('монеты ограничены 0–1000', (() => { const u = cleanUnits([unit([node({ xp: 99999 }), node({ id: 'n2', xp: -5 })])]); return u[0].nodes[0].xp === 1000 && u[0].nodes[1].xp === 0 })())
ok('слишком много юнитов → 400', code(() => cleanUnits(Array.from({ length: LIMITS.units + 1 }, (_, i) => unit([], { id: `u${i}` })))) === 400)
ok('слишком много кружков → 400', code(() => cleanUnits([unit(Array.from({ length: LIMITS.nodes + 1 }, (_, i) => node({ id: `n${i}` })))])) === 400)
ok('done — только true', cleanUnits([unit([node({ done: 'yes' })])])[0].nodes[0].done === false)

// --- пресет ---
ok('пресет: имя обязательно', code(() => cleanPreset({ name: ' ', units: [] })) === 400)
ok('пресет: проходит', cleanPreset({ name: ' Базовый ', units: [unit()] }).name === 'Базовый')

// --- колода ---
const card = (o: object = {}) => ({ id: 'c1', front: 'deadline', back: 'срок', ...o })
const deck = (o: object = {}) => ({ title: 'Business', forAll: true, assigned: [], newPerDay: 20, source: { url: '', lastSync: null }, cards: [card()], ...o })
ok('колода проходит, подсказки и скрытие сохраняются', (() => { const d = cleanDeck(deck({ cards: [card({ example: 'The deadline.', suspended: true })] })); return d.cards[0].example === 'The deadline.' && d.cards[0].suspended === true })())
ok('колода: название обязательно', code(() => cleanDeck(deck({ title: '' }))) === 400)
ok('колода: лимит новых ограничен 0–500', cleanDeck(deck({ newPerDay: 9999 })).newPerDay === 500 && cleanDeck(deck({ newPerDay: -3 })).newPerDay === 0)
ok('колода: назначенные без повторов', cleanDeck(deck({ assigned: ['a', 'a', 'b'] })).assigned.length === 2)
ok('колода: плохой id ученика → 400', code(() => cleanDeck(deck({ assigned: ['a/b'] }))) === 400)
ok('колода: карточка без слова или перевода → 400', code(() => cleanDeck(deck({ cards: [card({ back: '' })] }))) === 400)
ok('колода: повтор id карточек → 400', code(() => cleanDeck(deck({ cards: [card(), card()] }))) === 400)
ok('колода: слишком много карточек → 400', code(() => cleanDeck(deck({ cards: Array.from({ length: LIMITS.cards + 1 }, (_, i) => card({ id: `c${i}` })) }))) === 400)
ok('колода: слишком большая → 413', code(() => cleanDeck(deck({ cards: Array.from({ length: 3500 }, (_, i) => card({ id: `c${i}`, front: 'x'.repeat(250), back: 'y'.repeat(250), example: 'z'.repeat(250) })) }))) === 413)
ok('колода: дата синхронизации только настоящая', cleanDeck(deck({ source: { url: 'https://x', lastSync: 'вчера' } })).source.lastSync === null && cleanDeck(deck({ source: { url: 'https://x', lastSync: '2026-10-26T08:00:00.000Z' } })).source.lastSync === '2026-10-26T08:00:00.000Z')

// --- повторения ---
const st = (o: object = {}) => ({ ease: 2.5, interval: 3, reps: 2, lapses: 0, first: '2026-10-20', last: '2026-10-25', due: '2026-10-28', ...o })
ok('состояние карточки проходит', cleanSrsState(st()).interval === 3)
ok('лёгкость ниже 1.3 → 400', code(() => cleanSrsState(st({ ease: 0.5 }))) === 400)
ok('интервал не число → 400', code(() => cleanSrsState(st({ interval: 'много' }))) === 400)
ok('плохая дата в состоянии → 400', code(() => cleanSrsState(st({ due: 'завтра' }))) === 400)
ok('ответ: state может быть null (отмена)', cleanRate({ cardId: 'c1', state: null, date: '2026-10-26', delta: -1 }).state === null)
ok('ответ: delta только 1 или −1', code(() => cleanRate({ cardId: 'c1', state: null, date: '2026-10-26', delta: 5 })) === 400)

process.exit(bad ? 1 : 0)
