// Запуск: npx tsx tgphoto.test.ts  (сеть не нужна: страница t.me подставляется)
import { cleanUsername, isUsername, parsePhoto, photoByUsername } from './tgphoto.js'
let bad = 0
const ok = (name: string, c: unknown) => { console.log(c ? 'PASS' : 'FAIL', name); if (!c) bad++ }
const page = (img: string) => `<html><div class="tgme_page_photo"><a href="x">${img}</a></div></html>`
const resp = (body: string, status = 200) => async () => new Response(body, { status })

ok('cleanUsername: @, ссылки, параметры', cleanUsername('@maria') === 'maria' && cleanUsername(' t.me/maria?start=1 ') === 'maria' && cleanUsername('https://telegram.me/maria/') === 'maria' && cleanUsername(undefined) === '')
ok('isUsername: 5–32 символа, латиница/цифры/_, с буквы', isUsername('maria') && isUsername('Anna_En1') && !isUsername('abcd') && !isUsername('1maria') && !isUsername('ma ria') && !isUsername('марияааа'))
ok('parsePhoto: берёт фото, &amp; раскодирует', parsePhoto(page('<img class="tgme_page_photo_image" src="https://cdn4.cdn-telegram.org/file/a.jpg?x=1&amp;y=2">')) === 'https://cdn4.cdn-telegram.org/file/a.jpg?x=1&y=2')
ok('parsePhoto: атрибуты в другом порядке', parsePhoto(page('<img src="https://cdn1.telesco.pe/file/b.jpg" class="tgme_page_photo_image" alt="">')) === 'https://cdn1.telesco.pe/file/b.jpg')
ok('parsePhoto: нет фото → пусто', parsePhoto('<html><div class="tgme_page_title">Мария</div></html>') === '')
ok('parsePhoto: чужой хост и http отброшены', parsePhoto(page('<img class="tgme_page_photo_image" src="https://evil.example/a.jpg">')) === '' && parsePhoto(page('<img class="tgme_page_photo_image" src="http://cdn1.telesco.pe/a.jpg">')) === '')
ok('photoByUsername: страница с фото', (await photoByUsername('maria_en', resp(page('<img class="tgme_page_photo_image" src="https://cdn1.telesco.pe/c.jpg">')) as any)) === 'https://cdn1.telesco.pe/c.jpg')
ok('photoByUsername: 404 и кривой ник → пусто, без запроса для кривого', (await photoByUsername('maria_en', resp('', 404) as any)) === '' && (await photoByUsername('a b', (() => { throw new Error('не должен вызываться') }) as any)) === '')
process.exit(bad ? 1 : 0)
