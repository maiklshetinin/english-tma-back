// Все сущности проекта — в одном месте. Файл ЧИСТЫЙ: никаких импортов (ни firebase-admin, ни express),
// поэтому фронт может брать отсюда типы:  import type { Student } from '../../server/types'
//
// У каждой сущности до трёх «форм»:
//   • <Имя>Doc — документ в Firestore (все поля, включая служебные: archived, createdBy, createdAt…)
//   • <Имя>    — то, что сервер отдаёт на сайт (без служебных полей, с id); это то, что видит фронт
//   • *Input   — то, что сайт присылает на сервер
//
// Коллекции Firestore: users · students · invites · lessons · schedule

/** Момент времени из Firestore (FieldValue.serverTimestamp() при записи, Timestamp при чтении). */
export type ServerTime = unknown

// ───────────────────────── Общее ─────────────────────────
export const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const
export type Level = (typeof LEVELS)[number]

export type Role = 'teacher' | 'student'
export type StudentStatus = 'invited' | 'active'        // invited — «Ждёт приглашения», active — «В приложении»
export type PaymentStatus = 'paid' | 'due' | 'overdue'  // оплачено · ожидает оплаты · просрочено

/** Клеймы Firebase-токена, которые сервер кладёт при входе (login.ts) и читает фронт (stores/auth.ts). Лимит клеймов — 1000 байт. */
export interface SessionClaims {
  role: Role
  studentId: string | null     // у ученика — id его записи, у преподавателя null
  tgName: string
  tgUsername: string
  tgPhoto: string
}

/** Пользователь из проверенного Firebase ID-токена (req.user). Роль и studentId лежат в клеймах токена. */
export interface TokenUser {
  uid: string                  // 'tg:<Telegram id>'
  role?: Role
  studentId?: string | null
}

// ───────────────────────── Ученик · коллекция students ─────────────────────────
export interface Payment {
  status: PaymentStatus
  until: string                // 'YYYY-MM-DD' — оплачено до
  lessonsLeft: number
  packageSize: number          // 1–100
}

export interface StudentDoc {
  name: string                 // 1–40 символов
  level: Level
  color: string                // '#rrggbb', выбирается по кругу из палитры
  status: StudentStatus
  archived: boolean
  tgId: number | null          // Telegram id, пока null — ученик ещё не открыл приглашение
  username: string
  photoUrl: string
  price: number                // цена одного урока, 0 — не указана
  streak: number
  coins: number
  payment: Payment
  createdBy: string            // uid преподавателя
  createdAt: ServerTime
  joinedAt?: ServerTime        // когда принял приглашение
  lastLoginAt?: ServerTime
  archivedAt?: ServerTime
}

/** Ученик, как его видит сайт (ответ GET /students). Во фронте photoUrl превращается в photo_url (useStudents.js). */
export interface Student {
  id: string
  name: string
  level: Level
  color: string
  username: string
  streak: number
  coins: number
  status: StudentStatus
  tgId: number | null
  photoUrl: string
  price: number                // цена одного урока, 0 — не указана
  payment: Payment
}

export interface StudentInput {            // POST /students
  name: string
  level?: Level                            // по умолчанию 'A1'
  packageSize?: number                     // по умолчанию 8
  username?: string                        // ник в Telegram (можно с @ или ссылкой t.me/…); по нему сразу берём фото
  price?: number                           // цена урока, 0–100000
}

// ───────────────────────── Приглашение · коллекция invites ─────────────────────────
export interface InviteDoc {              // id документа — одноразовый код из ссылки
  studentId: string
  createdBy: string
  createdAt: ServerTime
  usedBy?: string                          // uid, который открыл ссылку
  usedAt?: ServerTime
}

// ───────────────────────── Пользователь · коллекция users ─────────────────────────
export interface UserDoc {                // id документа — 'tg:<Telegram id>'
  tgId: number
  name: string
  username: string
  photoUrl: string
  role: Role
  studentId?: string | null                // только у ученика
  lastLoginAt: ServerTime
  createdAt?: ServerTime
}

// ───────────────────────── Урок · коллекция lessons ─────────────────────────
export interface LessonDoc {
  date: string                 // 'YYYY-MM-DD'
  hour: number                 // 8–22
  weekStart: string            // понедельник той недели, где лежит дата
  studentIds: string[]         // один ученик или группа (до 12)
  createdBy: string
  createdAt: ServerTime
}

/** Урок на сайте (ответ GET /schedule, POST /lessons, POST /lessons/:id/move). */
export interface Lesson {
  id: string
  date: string
  hour: number
  studentIds: string[]         // у ученика — только он сам, чужих не видно
}

export interface LessonInput {             // POST /lessons
  studentId?: string                       // либо один…
  studentIds?: string[]                    // …либо несколько (группа)
  date: string
  hour: number
}
export interface SlotInput { date: string; hour: number }   // POST /lessons/:id/move

// ───────────────────────── Неделя · коллекция schedule ─────────────────────────
export interface WeekDoc {                // id документа — понедельник недели
  weekStart: string
  slots: Record<string, string>            // 'YYYY-MM-DD_HH' → id урока
}

export interface ScheduleWeek { weekStart: string; lessons: Lesson[] }
/** Ответ GET /schedule: две живые недели. */
export interface ScheduleResponse { current: ScheduleWeek; next: ScheduleWeek }

// ───────────────────────── Ответы остальных маршрутов ─────────────────────────
export interface AuthResponse { token: string }                       // POST /auth/telegram, /auth/telegram-widget
export interface CreateStudentResponse { student: Student; url: string }   // POST /students
export interface InviteResponse { url: string }                       // POST /invites
export interface PingResponse { ok: true; who: string }               // POST /ping

// ───────────────────────── Путь ученика · коллекция paths (id документа — id ученика) ─────────────────────────
// Путь — это юниты, в юнитах «кружки» (узлы). Урок с учителем (tutor) привязан к дате и времени, остальные — задания.
export const NODE_TYPES = ['tutor', 'hw', 'cards', 'combo'] as const
export type NodeType = (typeof NODE_TYPES)[number]       // tutor — урок · hw — домашнее задание · cards — повторение слов · combo — слова + ДЗ

export interface PathNode {
  id: string
  type: NodeType
  title: string
  xp: number                   // монеты за выполнение, 0–1000
  done: boolean
  desc?: string                // текст задания
  date?: string                // 'YYYY-MM-DD' — привязка к календарю (у пресетов нет)
  time?: string                // 'HH:MM' — только у уроков (tutor)
  deckId?: string              // колода для cards / combo; без неё берётся первая доступная
}
export interface PathUnit { id: string; title: string; sub: string; nodes: PathNode[] }

export interface PathDoc { units: PathUnit[]; updatedAt: ServerTime }

// ───────────────────────── Пресет пути · коллекция presets ─────────────────────────
// Заготовка без дат: преподаватель добавляет её в путь ученика. Общая для всех преподавателей.
export interface Preset { id: string; name: string; units: PathUnit[] }
export interface PresetDoc { name: string; units: PathUnit[]; createdBy: string; createdMs: number; updatedAt: ServerTime }
export interface PresetInput { name: string; units: PathUnit[] }

// ───────────────────────── Колода слов · коллекция decks ─────────────────────────
export interface Card { id: string; front: string; back: string; example?: string; suspended?: boolean }
export interface DeckSource { url: string; lastSync: string | null }     // ссылка на Google Таблицу и время последней синхронизации (ISO)
export interface Deck {
  id: string
  title: string
  forAll: boolean              // для всех учеников…
  assigned: string[]           // …иначе только для этих id учеников
  newPerDay: number            // лимит новых карточек в день, 0–500
  source: DeckSource
  cards: Card[]
}
export interface DeckDoc extends Omit<Deck, 'id'> { createdBy: string; createdMs: number; updatedAt: ServerTime }
export type DeckInput = Omit<Deck, 'id'>

// ───────────────────────── Прогресс повторений · коллекция srs ─────────────────────────
// Документ на пользователя: id ученика, а у преподавателя — 'teacher_<uid>'. Одну колоду видят многие, прогресс у каждого свой.
export interface SrsState {
  ease: number                 // «лёгкость», 1.3 и выше
  interval: number             // дней до следующего повторения; 0 — «снова», повторить сегодня
  reps: number
  lapses: number
  first: string                // 'YYYY-MM-DD' — когда карточка показана впервые
  last: string
  due: string                  // когда повторять
}
export interface SrsUser {
  cards: Record<string, SrsState>      // id карточки → состояние
  log: Record<string, number>          // 'YYYY-MM-DD' → сколько ответов дано в этот день
}
export interface SrsDoc extends SrsUser { updatedAt: ServerTime }
export interface SrsRateInput {        // POST /srs/rate — один ответ на карточку (или его отмена)
  cardId: string
  state: SrsState | null               // новое состояние; null — карточку вернули в «новые» (отмена первого ответа)
  date: string                         // день ответа у пользователя
  delta: 1 | -1                        // +1 ответ или −1 (отмена)
}

// ───────────────────────── Ответы маршрутов контента ─────────────────────────
/** GET /content. Преподаватель получает всё; ученик — только свой путь и доступные ему колоды, без пресетов. */
export interface ContentResponse { paths: Record<string, PathUnit[]>; presets: Preset[]; decks: Deck[] }
/** GET /srs. Ключ — id ученика, а собственный прогресс преподавателя приходит под ключом 'teacher'. */
export interface SrsResponse { users: Record<string, SrsUser> }
export interface CompleteResponse { coins: number }     // POST /paths/:studentId/complete — монеты ученика после начисления
