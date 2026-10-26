// Запуск: npx tsx students.test.ts  (без Firebase — база в памяти)
import { store, db, FieldValue } from './fake-db.js'
import { makeStudents } from './students.js'
import type { TokenUser } from './types.js'

const asked: string[] = []
const S = makeStudents({ db, FieldValue, photoByUsername: async (u) => { asked.push(u); if (u === 'boom_user') throw new Error('net'); return u === 'no_photo' ? '' : `https://cdn4.telesco.pe/file/${u}.jpg` } })
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
