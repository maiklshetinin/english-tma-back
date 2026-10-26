// Фото по нику Telegram. Bot API не умеет искать человека по @нику (только по числовому id, и то после его входа),
// поэтому берём фото с публичной страницы https://t.me/<ник> — той, что открывается в браузере. Фото там есть, только если
// в настройках приватности Telegram у человека «Фото профиля» видно всем. Нет фото / страница не открылась → пустая строка.
const NICK = /^[A-Za-z][A-Za-z0-9_]{4,31}$/

/** «@maria», «maria», «https://t.me/maria», «t.me/maria?start=1» → «maria» (без проверки формата) */
export function cleanUsername(raw: unknown): string {
  return String(raw ?? '').trim().replace(/^(https?:\/\/)?(www\.)?(t|telegram)\.me\//i, '').replace(/^@/, '').split(/[/?#\s]/)[0]
}
export const isUsername = (s: string) => NICK.test(s)

/** Адрес картинки из html страницы t.me; пусто, если у профиля нет открытого фото */
export function parsePhoto(html: string): string {
  const img = /<img\b[^>]*\bclass="[^"]*tgme_page_photo_image[^"]*"[^>]*>/i.exec(html)?.[0]
  const src = img && /\bsrc="([^"]+)"/i.exec(img)?.[1]?.replace(/&amp;/g, '&')
  if (!src) return ''
  try { const u = new URL(src); return u.protocol === 'https:' && /(^|\.)(telesco\.pe|cdn-telegram\.org|telegram\.org)$/.test(u.hostname) ? u.href : '' } catch { return '' }
}

export async function photoByUsername(username: string, fetchFn: typeof fetch = fetch): Promise<string> {
  if (!isUsername(username)) return ''
  const r = await fetchFn(`https://t.me/${username}`, { signal: AbortSignal.timeout(4000), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; tutor-tma)' } })
  return r.ok ? parsePhoto(await r.text()) : ''
}
