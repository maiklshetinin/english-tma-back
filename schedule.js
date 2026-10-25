// Расписание: уроки и две живые недели (текущая и следующая). Сайт НЕ ходит в Firestore напрямую — только через эти функции.
// Тест: node schedule.test.mjs
//
// Что лежит в базе:
//  • lessons/<id>   — сущность УРОКА: { date, hour, weekStart, studentIds: [...], createdBy, createdAt }.
//                     Учеников в уроке может быть несколько (групповое занятие) — это просто массив studentIds.
//  • schedule/<понедельник недели, YYYY-MM-DD> — НЕДЕЛЯ: { weekStart, slots: { "2026-10-26_09": "<lessonId>", … } }.
//                     Ключ слота — дата и час, значение — id урока. Один слот = один урок (преподаватель один).
// «Текущая» и «следующая» неделя вычисляются по дате (часовой пояс SCHEDULE_TZ), поэтому ничего не нужно «переносить»:
// в понедельник следующая неделя сама становится текущей, а старые недели остаются в базе как история.
import { fail } from './login.js'

export const HOUR_MIN = 8, HOUR_MAX = 22                 // как в таблице на сайте: 08:00 … 22:00
const ID = /^[\w-]{1,64}$/
const MAX_GROUP = 12

const pad = (n) => String(n).padStart(2, '0')
const toYmd = (d) => d.toISOString().slice(0, 10)
const parseYmd = (s) => {                                  // 'YYYY-MM-DD' → Date (UTC, полночь) или null, если даты не существует
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const d = new Date(s + 'T00:00:00Z')
  return Number.isNaN(d.getTime()) || toYmd(d) !== s ? null : d
}
export const addDays = (s, n) => { const d = parseYmd(s); d.setUTCDate(d.getUTCDate() + n); return toYmd(d) }
export const weekStartOf = (s) => addDays(s, -((parseYmd(s).getUTCDay() + 6) % 7))      // понедельник той недели, где лежит дата
export const todayIn = (tz, now) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
export const slotKey = (date, hour) => `${date}_${pad(hour)}`

const pub = (id, x) => ({ id, date: x.date, hour: x.hour, studentIds: [...x.studentIds] })
const byTime = (a, b) => a.date.localeCompare(b.date) || a.hour - b.hour

export function makeSchedule({ db, FieldValue, tz = 'Europe/Warsaw', now = () => new Date() }) {
  const lessons = () => db.collection('lessons'), weeks = () => db.collection('schedule'), students = () => db.collection('students')
  const liveWeeks = () => { const w = weekStartOf(todayIn(tz, now())); return [w, addDays(w, 7)] }   // [текущая, следующая]

  // Недели читаем и пишем целиком внутри транзакции: сначала все чтения, потом save() — одним махом
  const weekLoader = (tx) => {
    const cache = new Map()
    return {
      async get(ws) {
        if (!cache.has(ws)) { const ref = weeks().doc(ws); cache.set(ws, { ref, ws, slots: { ...((await tx.get(ref)).get('slots') || {}) } }) }
        return cache.get(ws)
      },
      save() { for (const w of cache.values()) tx.set(w.ref, { weekStart: w.ws, slots: w.slots }) },
    }
  }
  const slotOf = (input) => {                                // проверка «куда»: дата, час и что неделя — текущая или следующая
    const hour = input?.hour
    if (!parseYmd(input?.date)) throw fail(400, 'bad date')
    if (!Number.isInteger(hour) || hour < HOUR_MIN || hour > HOUR_MAX) throw fail(400, 'bad hour')
    const ws = weekStartOf(input.date)
    if (!liveWeeks().includes(ws)) throw fail(400, 'date outside current and next week')
    return { date: input.date, hour, ws, key: slotKey(input.date, hour) }
  }
  const checkId = (id) => { if (!ID.test(String(id))) throw fail(400, 'bad id'); return String(id) }

  return {
    liveWeeks,

    // Создаёт документы обеих недель, если их ещё нет (пустые слоты) — «записи в базе на 2 недели»
    async ensureWeeks() {
      await Promise.all(liveWeeks().map(ws => db.runTransaction(async (tx) => {
        const ref = weeks().doc(ws)
        if (!(await tx.get(ref)).exists) tx.set(ref, { weekStart: ws, slots: {} })
      })))
    },

    // Преподаватель — все уроки двух недель; ученик — только свои (и без чужих учеников в списке); остальным — пусто
    async list(user) {
      const [cur, next] = liveWeeks()
      let me = null
      if (user.role === 'teacher') await this.ensureWeeks()
      else if (user.role === 'student' && user.studentId) {
        const st = await students().doc(String(user.studentId)).get()
        if (st.exists && !st.get('archived') && `tg:${st.get('tgId')}` === user.uid) me = String(user.studentId)
      }
      const read = async (ws) => {
        if (user.role !== 'teacher' && !me) return { weekStart: ws, lessons: [] }
        let docs = (await lessons().where('weekStart', '==', ws).get()).docs.map(d => pub(d.id, d.data()))
        if (me) docs = docs.filter(l => l.studentIds.includes(me)).map(l => ({ ...l, studentIds: [me] }))
        return { weekStart: ws, lessons: docs.sort(byTime) }
      }
      return { current: await read(cur), next: await read(next) }
    },

    // Новый урок в слот. studentIds — один ученик (обычный урок) или несколько (группа).
    async create(input, by) {
      const raw = Array.isArray(input?.studentIds) ? input.studentIds : input?.studentId != null ? [input.studentId] : []
      const ids = [...new Set(raw.map(checkId))]
      if (!ids.length || ids.length > MAX_GROUP) throw fail(400, `studentIds: 1–${MAX_GROUP}`)
      const slot = slotOf(input)
      for (const id of ids) { const st = await students().doc(id).get(); if (!st.exists || st.get('archived')) throw fail(404, 'student not found') }
      const ref = lessons().doc(), data = { date: slot.date, hour: slot.hour, studentIds: ids }
      await db.runTransaction(async (tx) => {
        const W = weekLoader(tx), w = await W.get(slot.ws)
        if (w.slots[slot.key]) throw fail(409, 'slot busy')
        w.slots[slot.key] = ref.id
        tx.set(ref, { ...data, weekStart: slot.ws, createdBy: by, createdAt: FieldValue.serverTimestamp() })
        W.save()
      })
      return pub(ref.id, data)
    },

    // Перенос урока в пустой слот (другая неделя тоже можно)
    async move(id, input) {
      checkId(id); const slot = slotOf(input); let out
      await db.runTransaction(async (tx) => {
        const ref = lessons().doc(id), l = await tx.get(ref)
        if (!l.exists) throw fail(404, 'lesson not found')
        const W = weekLoader(tx), from = await W.get(l.get('weekStart')), to = await W.get(slot.ws)
        out = pub(id, { ...l.data(), date: slot.date, hour: slot.hour })
        const fromKey = slotKey(l.get('date'), l.get('hour'))
        if (fromKey === slot.key) return                       // уже в этом слоте
        if (to.slots[slot.key]) throw fail(409, 'slot busy')
        delete from.slots[fromKey]
        to.slots[slot.key] = id
        tx.update(ref, { date: slot.date, hour: slot.hour, weekStart: slot.ws })
        W.save()
      })
      return out
    },

    // Два урока меняются слотами
    async swap(aId, bId) {
      checkId(aId); checkId(bId)
      if (aId === bId) throw fail(400, 'same lesson')
      await db.runTransaction(async (tx) => {
        const [a, b] = [await tx.get(lessons().doc(aId)), await tx.get(lessons().doc(bId))]
        if (!a.exists || !b.exists) throw fail(404, 'lesson not found')
        const W = weekLoader(tx), wa = await W.get(a.get('weekStart')), wb = await W.get(b.get('weekStart'))
        const ka = slotKey(a.get('date'), a.get('hour')), kb = slotKey(b.get('date'), b.get('hour'))
        wa.slots[ka] = bId; wb.slots[kb] = aId
        tx.update(a.ref, { date: b.get('date'), hour: b.get('hour'), weekStart: b.get('weekStart') })
        tx.update(b.ref, { date: a.get('date'), hour: a.get('hour'), weekStart: a.get('weekStart') })
        W.save()
      })
    },

    // Урок удаляется, слот освобождается
    async remove(id) {
      checkId(id)
      await db.runTransaction(async (tx) => {
        const ref = lessons().doc(id), l = await tx.get(ref)
        if (!l.exists) throw fail(404, 'lesson not found')
        const W = weekLoader(tx), w = await W.get(l.get('weekStart')), k = slotKey(l.get('date'), l.get('hour'))
        if (w.slots[k] === id) delete w.slots[k]
        tx.delete(ref); W.save()
      })
    },

    // Ученика архивировали: убираем его из уроков двух живых недель; если урок остался без учеников — удаляем его
    async dropStudent(studentId) {
      for (const ws of liveWeeks()) {
        for (const d of (await lessons().where('weekStart', '==', ws).get()).docs) {
          if (!d.get('studentIds').includes(studentId)) continue
          await db.runTransaction(async (tx) => {
            const l = await tx.get(d.ref); if (!l.exists) return
            const rest = l.get('studentIds').filter(x => x !== studentId)
            if (rest.length) return void tx.update(d.ref, { studentIds: rest })
            const W = weekLoader(tx), w = await W.get(ws), k = slotKey(l.get('date'), l.get('hour'))
            if (w.slots[k] === d.id) delete w.slots[k]
            tx.delete(d.ref); W.save()
          })
        }
      }
    },
  }
}
