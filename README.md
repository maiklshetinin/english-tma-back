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
| `ALLOWED_ORIGIN` | откуда можно обращаться: `https://<ваш_ник>.github.io` (через запятую можно добавить `http://localhost:5173`) |

Локально: скопируйте их в `server/.env` и `npm run dev`.

## Маршруты
- `POST /auth/telegram` — вход из мини-приложения (`Authorization: tma <initData>`)
- `POST /auth/telegram-widget` — вход в браузере (данные Login Widget)
- `POST /invites` — ссылка-приглашение `{ studentId }` (преподаватель)
- `GET /avatar/:tgId`, `GET /sheets/csv?url=` — с `Authorization: Bearer <Firebase ID token>`

Роли: преподаватель — тот, чей id в `TEACHER_IDS`; ученик — тот, кто открыл одноразовую ссылку-приглашение; остальным вход закрыт (403).
