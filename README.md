# Сервер (Render)

Проверяет вход через Telegram, выдаёт Firebase-токен, создаёт приглашения для учеников, отдаёт аватарки и CSV из Google Таблиц.

## Render
New → Web Service → этот репозиторий, **Root Directory: `server`**, Build: `npm install --include=dev && npm run build`, Start: `npm start`.

Сервер написан на TypeScript: `npm run build` (tsc) собирает его в `dist/`, `npm start` запускает `node dist/index.js`. `--include=dev` нужен, потому что `typescript` лежит в devDependencies, а Render может ставить только production-зависимости.

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

Локально: скопируйте их в `server/.env` и `npm run dev` (`tsx watch`, перезапускается при правках).

## Маршруты
- `POST /auth/telegram` — вход из мини-приложения (`Authorization: tma <initData>`)
- `POST /auth/telegram-widget` — вход в браузере (данные Login Widget)
- `GET /students` — преподаватель: все активные ученики; ученик: только своя запись
- `POST /students` — добавить ученика `{ name, level, packageSize, username?, price? }` и сразу получить ссылку-приглашение (преподаватель). `username` — ник в Telegram (с `@` или ссылкой `t.me/…`): по нему сервер берёт фото с публичной страницы `t.me/<ник>` (`tgphoto.ts`; фото есть, только если оно открыто в приватности Telegram). `price` — цена урока, 0–100000
- `POST /invites` — новая одноразовая ссылка для существующего ученика `{ studentId }` (преподаватель)
- `POST /students/:id/archive` — архив ученика: скрывает запись, удаляет его `users/tg:<id>`, гасит неиспользованные приглашения (преподаватель)
- `GET /schedule` — две живые недели `{ current: { weekStart, lessons }, next: {…} }`; преподаватель — все уроки, ученик — только свои
- `POST /lessons` — урок в слот `{ studentId | studentIds, date: 'YYYY-MM-DD', hour: 8–22 }`; слот занят → 409, неделя не текущая и не следующая → 400 (преподаватель)
- `POST /lessons/:id/move` `{ date, hour }`, `POST /lessons/swap` `{ a, b }`, `DELETE /lessons/:id` (преподаватель)
- `GET /content` — `{ paths, presets, decks }`: преподаватель получает всё; ученик — **только свой путь** и колоды, доступные ему (для всех или назначенные), без пресетов
- `PUT /paths/:studentId` `{ units }` — путь ученика целиком (преподаватель). Отметки «выполнено» не снимаются: если пришла старая версия, где кружок ещё не выполнен, он остаётся выполненным
- `POST /paths/:studentId/complete` `{ nodeId }` → `{ coins }` — отметить кружок выполненным и начислить монеты (один раз). Преподаватель — любой кружок, ученик — только свой и только текущий (первый невыполненный), иначе 409
- `PUT /presets/:id` `{ name, units }`, `DELETE /presets/:id` (преподаватель) — id придумывает сайт
- `PUT /decks/:id` `{ title, forAll, assigned, newPerDay, source, cards }`, `DELETE /decks/:id` (преподаватель)
- `GET /srs` → `{ users }` — прогресс повторений: ученик — свой, преподаватель — всех учеников и свой (под ключом `teacher`)
- `POST /srs/rate` `{ cardId, state | null, date, delta: 1 | -1 }` — ответ на карточку или его отмена; пишется **только в документ самого пользователя**

Все данные от сайта проходят через `clean.ts`: лишние поля отрезаются, типы, длины и количество проверяются (юнитов ≤ 60, кружков в юните ≤ 80, карточек в колоде ≤ 4000, колода ≤ ~900 КБ), неверное — `400`, слишком большое — `413`. Путь, пресеты и колоды принимаются с телом до 1 МБ, остальные запросы — до 10 КБ.
- `GET /avatar/:tgId`, `GET /sheets/csv?url=` — с `Authorization: Bearer <Firebase ID token>`

Файлы: `types.ts` (**все сущности в одном месте**, см. ниже), `index.ts` (маршруты), `login.ts` (вход и роли), `students.ts` (ученики, приглашения, архив), `schedule.ts` (уроки и недели), `content.ts` (путь, пресеты, колоды), `srs.ts` (прогресс повторений), `clean.ts` (проверка входных данных), `errors.ts` (HTTP-ошибки), `access.ts` (привязка ученика к аккаунту), `telegram.ts` (проверка подписи). Тесты без Firebase (база в памяти, `fake-db.ts`): `npm test`. Проверка типов без сборки: `npm run typecheck`.

## Сущности (`types.ts`)
Файл `types.ts` — единственное место, где описаны поля всех коллекций Firestore (`users`, `students`, `invites`, `lessons`, `schedule`, `paths`, `presets`, `decks`, `srs`). У каждой сущности до трёх форм: `<Имя>Doc` — документ в базе (со служебными полями), `<Имя>` — то, что сервер отдаёт на сайт, `*Input` — то, что сайт присылает. Файл не импортирует ничего, кроме типов, поэтому фронт может брать оттуда типы (`import type`), а в браузер ничего из сервера не попадает. Добавляя поле, меняйте сначала `types.ts` — компилятор покажет все места, которые нужно поправить.

Сайт не обращается к Firestore напрямую — только через эти маршруты; правила Firestore закрывают базу от клиентов (`firestore.rules` в корне репозитория фронта).

Роли: преподаватель — тот, чей id в `TEACHER_IDS`; ученик — тот, кто открыл одноразовую ссылку-приглашение на свою запись в `students`; остальным вход закрыт (403).
