// Запуск: npx tsx students.test.ts  (без Firebase — база в памяти)
import { store, db, FieldValue } from './fake-db.js'
import { makeStudents } from './students.js'
import type { TokenUser } from './types.js'

const asked: string[] = []
let nowMs = new Date('2026-10-26T10:05:00+01:00').getTime()      // Варшава, CET: 10:05
const S = makeStudents({ db, FieldValue, now: () => new Date(nowMs), tz: 'Europe/Warsaw', photoByUsername: async (u) => { asked.push(u); if (u === 'boom_user') throw new Error('net'); return u === 'no_photo' ? '' : `https://cdn4.telesco.pe/file/${u}.jpg` } })
let bad = 0
const ok = (name: string, c: unknown) => { console.log(c ? 'PASS' : 'FAIL', name); if (!c) bad++ }
const code = async (p: Promise<unknown>) => { try { await p; return 200 } catch (e: any) { return e.status ?? 500 } }
const teacher: TokenUser = { uid: 'tg:1', role: 'teacher' }

// --- создание ---
ok('пустое имя → 400', (await code(S.create({ name: '  ' }, 'tg:1'))) === 400)
ok('имя длиннее 40 → 400', (await code(S.create({ name: 'x'.repeat(41) }, 'tg:1'))) === 400)
ok('неверный уровень → 400', (await code(S.create({ name: 'Маша', level: 'Z9' as any }, 'tg:1'))) === 400)
const masha = await S.create({ name: '  Маша ', level: 'A2', packageSize: 8 }, 'tg:1')
ok('создан: имя обрезано, статус «ждёт приглашения», не в архиве', masha.name === 'Маша' && masha.level === 'A2' && masha.status === 'invited' && store.get(`students/${masha.id}`).archived === false)
ok('создан: tgId пуст, оплата «ждёт», пакет 8', masha.tgId === null && masha.payment.status === 'due' && masha.payment.packageSize === 8)
const big = await S.create({ name: 'Петя', packageSize: 99999 }, 'tg:1')
ok('размер пакета ограничен 100', big.payment.packageSize === 100)
ok('цвета у соседних учеников разные', masha.color !== big.color)
ok('служебных полей (createdBy, archived) в ответе нет', !('createdBy' in masha) && !('archived' in masha))

// --- ник и цена ---
const ann = await S.create({ name: 'Аня', username: ' https://t.me/Anna_En?start=1 ', price: 120.456 }, 'tg:1')
ok('ник очищен от ссылки и @, фото найдено по нику', ann.username === 'Anna_En' && ann.photoUrl === 'https://cdn4.telesco.pe/file/Anna_En.jpg' && asked.at(-1) === 'Anna_En')
ok('цена округлена до копеек и лежит в записи', ann.price === 120.46 && store.get(`students/${ann.id}`).price === 120.46)
ok('ник с @ принимается', (await S.create({ name: 'Б', username: '@bob_en' }, 'tg:1')).username === 'bob_en')
ok('без ника и цены: пустые значения, фото не ищем', masha.username === '' && masha.photoUrl === '' && masha.price === 0 && !asked.includes(''))
ok('ник без фото → запись создана, фото пустое', (await S.create({ name: 'В', username: 'no_photo' }, 'tg:1')).photoUrl === '')
ok('сбой поиска фото не мешает созданию', (await S.create({ name: 'Г', username: 'boom_user' }, 'tg:1')).username === 'boom_user')
ok('кривой ник → 400', (await code(S.create({ name: 'Д', username: 'a b' }, 'tg:1'))) === 400 && (await code(S.create({ name: 'Д', username: 'ab' }, 'tg:1'))) === 400)
ok('отрицательная или нечисловая цена → 400', (await code(S.create({ name: 'Е', price: -1 }, 'tg:1'))) === 400 && (await code(S.create({ name: 'Е', price: 'abc' as any }, 'tg:1'))) === 400)

// --- ник у созданного ученика ---
const noNick = await S.create({ name: 'Лена' }, 'tg:1')
const withNick = await S.setUsername(noNick.id, '@Lena_En')
ok('ник добавлен позже: запись и ответ обновлены, фото найдено', withNick.username === 'Lena_En' && withNick.photoUrl === 'https://cdn4.telesco.pe/file/Lena_En.jpg' && store.get(`students/${noNick.id}`).username === 'Lena_En')
ok('смена ника на ник без фото сбрасывает старое фото', (await S.setUsername(noNick.id, 'no_photo')).photoUrl === '')
ok('сбой поиска при смене ника оставляет прежнее фото', (await S.setUsername(noNick.id, 'Lena_En'), (await S.setUsername(noNick.id, 'boom_user')).photoUrl === 'https://cdn4.telesco.pe/file/Lena_En.jpg'))
ok('setUsername: кривой ник → 400, мусорный id → 400, нет ученика → 404', (await code(S.setUsername(noNick.id, 'a b'))) === 400 && (await code(S.setUsername('../x', 'lena_en'))) === 400 && (await code(S.setUsername('nope', 'lena_en'))) === 404)
store.set(`students/${noNick.id}`, { ...store.get(`students/${noNick.id}`), tgId: 77 })
ok('ученик уже вошёл → 409, ник не менялся', (await code(S.setUsername(noNick.id, 'other_nick'))) === 409 && store.get(`students/${noNick.id}`).username === 'boom_user')
await S.archive(noNick.id)

// --- смена цены: прошедшие уроки не меняются ---
const pr = await S.create({ name: 'Паша', price: 100 }, 'tg:1')
ok('при создании в истории одна запись «с самого начала»', JSON.stringify(pr.priceHistory) === JSON.stringify([{ from: '', price: 100 }]))
const pr2 = await S.setPrice(pr.id, 150)
ok('цена сменена: текущая новая, новая запись действует со следующего часа, старая осталась', pr2.price === 150 && JSON.stringify(pr2.priceHistory) === JSON.stringify([{ from: '', price: 100 }, { from: '2026-10-26T11', price: 150 }]))
ok('в базе то же самое', store.get(`students/${pr.id}`).price === 150 && store.get(`students/${pr.id}`).priceHistory.length === 2)
ok('та же цена повторно — истории не прибавляется', (await S.setPrice(pr.id, 150)).priceHistory.length === 2)
ok('вторая правка в тот же час заменяет запись этого часа, а не копит, старая цена цела', JSON.stringify((await S.setPrice(pr.id, 200)).priceHistory) === JSON.stringify([{ from: '', price: 100 }, { from: '2026-10-26T11', price: 200 }]))
nowMs = new Date('2026-10-26T23:30:00+01:00').getTime()
ok('поздно вечером новая цена начинается с полуночи следующего дня', (await S.setPrice(pr.id, 250)).priceHistory.at(-1)!.from === '2026-10-27T00')
nowMs = new Date('2026-10-26T10:05:00+01:00').getTime()
const legacy = await S.create({ name: 'Старая запись', price: 90 }, 'tg:1')
const { priceHistory: _drop, ...noHist } = store.get(`students/${legacy.id}`); store.set(`students/${legacy.id}`, noHist)
ok('у записи без истории список отдаёт прежнюю цену «всегда»', JSON.stringify((await S.list(teacher)).find(x => x.id === legacy.id)!.priceHistory) === JSON.stringify([{ from: '', price: 90 }]))
const lg2 = await S.setPrice(legacy.id, 120)
ok('запись без истории: прошлое сохраняется по старой цене', JSON.stringify(lg2.priceHistory) === JSON.stringify([{ from: '', price: 90 }, { from: '2026-10-26T11', price: 120 }]))
ok('цена: кривая → 400, мусорный id → 400, нет ученика → 404', (await code(S.setPrice(pr.id, -5))) === 400 && (await code(S.setPrice(pr.id, 'abc'))) === 400 && (await code(S.setPrice(pr.id, 1e9))) === 400 && (await code(S.setPrice('../x', 10))) === 400 && (await code(S.setPrice('nope', 10))) === 404)
await S.archive(pr.id); await S.archive(legacy.id)
ok('архивному цену не меняем → 404', (await code(S.setPrice(pr.id, 10))) === 404)

// --- список: преподаватель ---
let list = await S.list(teacher)
ok('преподаватель видит всех активных', list.length === 6 && list.find(x => x.id === ann.id)?.price === 120.46)

// --- привязка ученика (как после входа по ссылке) ---
store.set(`students/${masha.id}`, { ...store.get(`students/${masha.id}`), tgId: 10, status: 'active' })
const mUser: TokenUser = { uid: 'tg:10', role: 'student', studentId: masha.id }
list = await S.list(mUser)
ok('ученик видит только свою запись', list.length === 1 && list[0].id === masha.id)
ok('чужой studentId в токене не даёт чужих данных', (await S.list({ uid: 'tg:10', role: 'student', studentId: big.id })).length === 0)
ok('аккаунт без роли ничего не видит', (await S.list({ uid: 'tg:99' })).length === 0)
ok('ученик без studentId ничего не видит', (await S.list({ uid: 'tg:10', role: 'student' })).length === 0)

// --- приглашения ---
ok('приглашение с мусорным id → 400', (await code(S.invite('../x', 'tg:1'))) === 400)
ok('приглашение на несуществующего → 404', (await code(S.invite('nope', 'tg:1'))) === 404)
const c1 = await S.invite(big.id, 'tg:1')
ok('приглашение создано, код ≥ 8 символов', /^[\w-]{8,}$/.test(c1) && store.get(`invites/${c1}`).studentId === big.id)

// --- перепривязка: запись теперь у другого аккаунта → старый токен ничего не видит ---
store.set(`students/${masha.id}`, { ...store.get(`students/${masha.id}`), tgId: 11 })
ok('после смены аккаунта старый токен ученика не читает запись', (await S.list(mUser)).length === 0)
store.set(`students/${masha.id}`, { ...store.get(`students/${masha.id}`), tgId: 10 })

// --- архив ---
store.set('users/tg:10', { role: 'student', studentId: masha.id })
const used = await S.invite(masha.id, 'tg:1'); store.set(`invites/${used}`, { ...store.get(`invites/${used}`), usedBy: 'tg:10' })
const free = await S.invite(masha.id, 'tg:1')
ok('архив несуществующего → 404', (await code(S.archive('nope'))) === 404)
await S.archive(masha.id)
ok('архив: запись помечена', store.get(`students/${masha.id}`).archived === true)
ok('архив: доступ аккаунта закрыт (users удалён)', !store.has('users/tg:10'))
ok('архив: неиспользованное приглашение погашено, использованное осталось', !store.has(`invites/${free}`) && store.has(`invites/${used}`))
ok('архивный пропал у преподавателя', (await S.list(teacher)).every(s => s.id !== masha.id))
ok('архивный не читается и самим учеником', (await S.list(mUser)).length === 0)
ok('приглашение на архивного → 404', (await code(S.invite(masha.id, 'tg:1'))) === 404)
process.exit(bad ? 1 : 0)
