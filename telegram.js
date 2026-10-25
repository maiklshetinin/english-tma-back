// Проверка подписи Telegram. Подделать данные без токена бота нельзя — именно на этом держится вход.
import crypto from 'node:crypto'

const hmac = (key, msg) => crypto.createHmac('sha256', key).update(msg).digest()
const same = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y) }
const MAX_AGE = 24 * 3600                                    // подпись старше суток не принимаем
const fresh = (t) => { const age = Date.now() / 1000 - Number(t); return Number.isFinite(age) && age < MAX_AGE && age > -60 }
const byKey = ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)

// Мини-приложение: сырая строка Telegram.WebApp.initData
export function verifyInitData(raw, botToken) {
  const p = new URLSearchParams(raw)
  const hash = p.get('hash'); p.delete('hash')
  if (!hash) return null
  const check = [...p.entries()].sort(byKey).map(([k, v]) => `${k}=${v}`).join('\n')
  if (!same(hmac(hmac('WebAppData', botToken), check).toString('hex'), hash) || !fresh(p.get('auth_date'))) return null
  try { return { user: JSON.parse(p.get('user')), startParam: p.get('start_param') || '' } } catch { return null }
}

// Кнопка «Войти через Telegram» (Login Widget) в обычном браузере
export function verifyWidget(data, botToken) {
  const { hash, ...rest } = data || {}
  if (!hash || !rest.id) return null
  const check = Object.keys(rest).sort().map(k => `${k}=${rest[k]}`).join('\n')
  const secret = crypto.createHash('sha256').update(botToken).digest()
  if (!same(hmac(secret, check).toString('hex'), String(hash)) || !fresh(rest.auth_date)) return null
  return { user: { id: rest.id, first_name: rest.first_name, username: rest.username, photo_url: rest.photo_url }, startParam: '' }
}
