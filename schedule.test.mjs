// Запуск: node schedule.test.mjs  (без Firebase — база в памяти)
import { store, db, FieldValue } from './fake-db.mjs'
import { makeStudents } from './students.js'
import { makeSchedule, weekStartOf, addDays, todayIn } from './schedule.js'

let bad = 0
const ok = (name, c) => { console.log(c ? 'PASS' : 'FAIL', name); if (!c) bad++ }
const code = async (p) => { try { await p; return 200 } catch (e) { return e.status ?? 500 } }

// Сегодня — воскресенье 25.10.2026 (Варшава), поэтому текущая неделя = 19–25 окт, следующая = 26 окт – 1 ноя
let clock = new Date('2026-10-25T12:00:00Z')
const S = makeSchedule({ db, FieldValue, tz: 'Europe/Warsaw', now: () => clock })
const ST = makeStudents({ db, FieldValue })
const teacher = { uid: 'tg:1', role: 'teacher' }
const A = '2026-10-21', B = '2026-10-27', FAR = '2026-11-03'      // ср текущей, вт следующей, вторник через неделю

// --- даты ---
ok('понедельник недели: вс 25.10 → 19.10', weekStartOf('2026-10-25') === '2026-10-19' && weekStartOf('2026-10-19') === '2026-10-19')
ok('addDays через границу месяца', addDays('2026-10-30', 3) === '2026-11-02')
ok('часовой пояс: 23:30 UTC в вс уже понедельник в Варшаве', todayIn('Europe/Warsaw', new Date('2026-10-25T23:30:00Z')) === '2026-10-26')

const masha = await ST.create({ name: 'Маша', level: 'A2' }, 'tg:1')
const petya = await ST.create({ name: 'Петя', level: 'B1' }, 'tg:1')
const olya = await ST.create({ name: 'Оля', level: 'B1' }, 'tg:1')

// --- обе недели создаются в базе сразу ---
let v = await S.list(teacher)
ok('обе недели есть в базе, слоты пусты', v.current.weekStart === '2026-10-19' && v.next.weekStart === '2026-10-26'
  && store.has('schedule/2026-10-19') && store.has('schedule/2026-10-26') && !Object.keys(store.get('schedule/2026-10-19').slots).length)
ok('уроков пока нет', !v.current.lessons.length && !v.next.lessons.length)

// --- создание: ученик попал в слот → появилась сущность урока ---
ok('мусорные данные → 400', (await code(S.create({ studentId: masha.id, date: '2026-13-40', hour: 9 }, 'tg:1'))) === 400
  && (await code(S.create({ studentId: masha.id, date: A, hour: 7 }, 'tg:1'))) === 400
  && (await code(S.create({ studentId: masha.id, date: A, hour: 9.5 }, 'tg:1'))) === 400
  && (await code(S.create({ date: A, hour: 9 }, 'tg:1'))) === 400
  && (await code(S.create({ studentId: '../x', date: A, hour: 9 }, 'tg:1'))) === 400)
ok('неделя за пределами «эта + следующая» → 400', (await code(S.create({ studentId: masha.id, date: FAR, hour: 9 }, 'tg:1'))) === 400
  && (await code(S.create({ studentId: masha.id, date: '2026-10-12', hour: 9 }, 'tg:1'))) === 400)
ok('несуществующий ученик → 404', (await code(S.create({ studentId: 'nope', date: A, hour: 9 }, 'tg:1'))) === 404)
const l1 = await S.create({ studentId: masha.id, date: A, hour: 9 }, 'tg:1')
ok('урок создан: сущность в lessons, id слота записан в неделю', store.get(`lessons/${l1.id}`).studentIds[0] === masha.id
  && store.get(`lessons/${l1.id}`).weekStart === '2026-10-19' && store.get('schedule/2026-10-19').slots['2026-10-21_09'] === l1.id)
ok('служебных полей в ответе нет', !('createdBy' in l1) && !('weekStart' in l1))
ok('занятый слот → 409, второй урок не создан', (await code(S.create({ studentId: petya.id, date: A, hour: 9 }, 'tg:1'))) === 409
  && [...store.keys()].filter(k => k.startsWith('lessons/')).length === 1)
const l2 = await S.create({ studentId: petya.id, date: B, hour: 18 }, 'tg:1')
ok('следующая неделя пишется в свой документ', store.get('schedule/2026-10-26').slots['2026-10-27_18'] === l2.id)

// --- группа: несколько учеников в одном уроке ---
const g = await S.create({ studentIds: [masha.id, petya.id, masha.id], date: A, hour: 12 }, 'tg:1')
ok('групповой урок: ученики без дублей', g.studentIds.length === 2)
ok('группа с архивным/чужим учеником → 404', (await code(S.create({ studentIds: [masha.id, 'nope'], date: A, hour: 13 }, 'tg:1'))) === 404)

v = await S.list(teacher)
ok('список: уроки по неделям, по времени', v.current.lessons.map(l => l.id).join() === [l1.id, g.id].join() && v.next.lessons.length === 1)

// --- перенос ---
ok('перенос в занятый слот → 409', (await code(S.move(l1.id, { date: A, hour: 12 }))) === 409)
ok('перенос несуществующего → 404', (await code(S.move('nope', { date: A, hour: 10 }))) === 404)
ok('перенос на неделю вне окна → 400', (await code(S.move(l1.id, { date: FAR, hour: 10 }))) === 400)
await S.move(l1.id, { date: A, hour: 9 })
ok('перенос в тот же слот ничего не ломает', store.get('schedule/2026-10-19').slots['2026-10-21_09'] === l1.id)
const m = await S.move(l1.id, { date: B, hour: 10 })
ok('перенос на другую неделю: старый слот свободен, новый занят, урок обновлён', m.date === B && !('2026-10-21_09' in store.get('schedule/2026-10-19').slots)
  && store.get('schedule/2026-10-26').slots['2026-10-27_10'] === l1.id && store.get(`lessons/${l1.id}`).weekStart === '2026-10-26')

// --- обмен ---
await S.swap(l1.id, l2.id)
ok('обмен: уроки поменялись слотами, в неделях всё сходится', store.get(`lessons/${l1.id}`).hour === 18 && store.get(`lessons/${l2.id}`).hour === 10
  && store.get('schedule/2026-10-26').slots['2026-10-27_18'] === l1.id && store.get('schedule/2026-10-26').slots['2026-10-27_10'] === l2.id)
await S.swap(l1.id, g.id)
ok('обмен между неделями', store.get(`lessons/${l1.id}`).weekStart === '2026-10-19' && store.get(`lessons/${g.id}`).weekStart === '2026-10-26'
  && store.get('schedule/2026-10-19').slots['2026-10-21_12'] === l1.id && store.get('schedule/2026-10-26').slots['2026-10-27_18'] === g.id)
ok('обмен урока с самим собой → 400, с чужим id → 404', (await code(S.swap(l1.id, l1.id))) === 400 && (await code(S.swap(l1.id, 'nope'))) === 404)

// --- удаление ---
await S.remove(l2.id)
ok('удаление: урока нет, слот свободен', !store.has(`lessons/${l2.id}`) && !('2026-10-27_10' in store.get('schedule/2026-10-26').slots))
ok('повторное удаление → 404', (await code(S.remove(l2.id))) === 404)
const again = await S.create({ studentId: petya.id, date: B, hour: 10 }, 'tg:1')
ok('освободившийся слот можно занять снова', !!again.id)

// --- ученик видит только своё ---
store.set(`students/${masha.id}`, { ...store.get(`students/${masha.id}`), tgId: 10, status: 'active' })
const mUser = { uid: 'tg:10', role: 'student', studentId: masha.id }
v = await S.list(mUser)
const mine = [...v.current.lessons, ...v.next.lessons]
ok('ученик видит только уроки со своим участием', mine.length === 2 && mine.every(l => l.studentIds.length === 1 && l.studentIds[0] === masha.id))
ok('ученик с чужим studentId / без роли ничего не видит', ![...(await S.list({ uid: 'tg:10', role: 'student', studentId: petya.id })).current.lessons].length
  && ![...(await S.list({ uid: 'tg:99' })).next.lessons].length)

// --- архив: ученик уходит из уроков, пустой урок удаляется ---
await ST.archive(petya.id); await S.dropStudent(petya.id)
ok('архив: одиночный урок ученика удалён вместе со слотом', !store.has(`lessons/${again.id}`) && !('2026-10-27_10' in store.get('schedule/2026-10-26').slots))
ok('архив: из группы ученик убран, урок остался', JSON.stringify(store.get(`lessons/${g.id}`).studentIds) === JSON.stringify([masha.id]))
ok('архивного ученика нельзя поставить в расписание', (await code(S.create({ studentId: petya.id, date: A, hour: 15 }, 'tg:1'))) === 404)
store.set(`students/${masha.id}`, { ...store.get(`students/${masha.id}`), archived: true })
ok('архивный ученик расписание не читает', ![...(await S.list(mUser)).current.lessons, ...(await S.list(mUser)).next.lessons].length)

// --- смена недели: в понедельник «следующая» становится «текущей», старая неделя остаётся в базе ---
clock = new Date('2026-10-25T23:30:00Z')                   // уже понедельник 26.10 по Варшаве
v = await S.list(teacher)
ok('в понедельник окно сдвинулось: текущая 26.10, следующая 02.11, прошлая неделя осталась в базе', v.current.weekStart === '2026-10-26' && v.next.weekStart === '2026-11-02'
  && store.has('schedule/2026-10-19') && store.has('schedule/2026-11-02') && v.current.lessons.some(l => l.id === g.id))
process.exit(bad ? 1 : 0)
