# Сервер (Render)

Проверяет вход через Telegram, выдаёт Firebase-токен, создаёт приглашения для учеников, отдаёт аватарки и CSV из Google Таблиц.

## Render
New → Web Service → этот репозиторий, **Root Directory: `server`**, Build: `npm install`, Start: `npm start`.

## Переменные окружения (Render → Environment)
| Переменная | Что это |
|---|---|
| `BOT_TOKEN` | токен бота из @BotFather (секрет) |
| `BOT_USERNAME` | ник бота без @ |
| `APP_SHORT_NAME` | short name мини-приложения из @BotFather → /newapp (если приложение задано как Main Mini App — не нужно) |
| `FIREBASE_SERVICE_ACCOUNT` | весь JSON сервисного ключа в одну строку: Firebase → Project settings → Service accounts → Generate new private key (секрет) |
| `TEACHER_IDS` | ваш Telegram id (число; узнать — @userinfobot), несколько через запятую |
| `SCHEDULE_TZ` | часовой пояс для «этой» и «следующей» недели (по умолчанию `Europe/Warsaw`) |
| `ALLOWED_ORIGIN` | откуда можно обращаться: `https://<ваш_ник>.github.io` (через запятую можно добавить `http://localhost:5173`) |

Локально: скопируйте их в `server/.env` и `npm run dev`.

## Маршруты
- `POST /auth/telegram` — вход из мини-приложения (`Authorization: tma <initData>`)
- `POST /auth/telegram-widget` — вход в браузере (данные Login Widget)
- `GET /students` — преподаватель: все активные ученики; ученик: только своя запись
- `POST /students` — добавить ученика `{ name, level, packageSize }` и сразу получить ссылку-приглашение (преподаватель)
- `POST /invites` — новая одноразовая ссылка для существующего ученика `{ studentId }` (преподаватель)
- `POST /students/:id/archive` — архив ученика: скрывает запись, удаляет его `users/tg:<id>`, гасит неиспользованные приглашения (преподаватель)
- `GET /schedule` — две живые недели `{ current: { weekStart, lessons }, next: {…} }`; преподаватель — все уроки, ученик — только свои
- `POST /lessons` — урок в слот `{ studentId | studentIds, date: 'YYYY-MM-DD', hour: 8–22 }`; слот занят → 409, неделя не текущая и не следующая → 400 (преподаватель)
- `POST /lessons/:id/move` `{ date, hour }`, `POST /lessons/swap` `{ a, b }`, `DELETE /lessons/:id` (преподаватель)
- `GET /avatar/:tgId`, `GET /sheets/csv?url=` — с `Authorization: Bearer <Firebase ID token>`

Файлы: `index.js` (маршруты), `login.js` (вход и роли), `students.js` (ученики, приглашения, архив), `schedule.js` (уроки и недели), `telegram.js` (проверка подписи). Тесты без Firebase (база в памяти): `npm install && node login.test.mjs && node students.test.mjs && node schedule.test.mjs`.

Сайт не обращается к Firestore напрямую — только через эти маршруты; правила Firestore закрывают базу от клиентов (`firestore.rules` в корне репозитория фронта).

Роли: преподаватель — тот, чей id в `TEACHER_IDS`; ученик — тот, кто открыл одноразовую ссылку-приглашение на свою запись в `students`; остальным вход закрыт (403).
