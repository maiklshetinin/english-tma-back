// Запуск: npx tsx login.test.ts  (без Firebase — база имитируется в памяти)
import { makeLogin } from './login.js'

import { store, db, FieldValue } from './fake-db.js'
const auth = { createCustomToken: async (uid: string, claims: object) => JSON.stringify({ uid, ...claims }) }
const login = makeLogin({ db, auth, FieldValue, teacherIds: ['1'] })

let bad = 0
const ok = (name: string, c: unknown) => { console.log(c ? 'PASS' : 'FAIL', name); if (!c) bad++ }
const tryLogin = async (id: number, startParam = '', extra: object = {}): Promise<any> => { try { return JSON.parse((await login({ user: { id, first_name: 'N' + id, username: 'u' + id, photo_url: 'p' + id, ...extra }, startParam })).token) } catch (e: any) { return { err: e.status } } }

store.set('students/s1', { name: 'Маша', archived: false, status: 'invited', tgId: null })
store.set('invites/inviteCodeAAAA', { studentId: 's1' })
store.set('invites/inviteCodeBBBB', { studentId: 's1' })
store.set('invites/inviteCodeZZZZ', { studentId: 'nope' })

let r = await tryLogin(1);                                  ok('преподаватель из TEACHER_IDS', r.role === 'teacher' && r.studentId === null)
r = await tryLogin(50);                                     ok('посторонний без приглашения → 403', r.err === 403)
r = await tryLogin(50, 'invite_inviteCodeZZZZ');            ok('приглашение на несуществующего ученика → 403', r.err === 403)
r = await tryLogin(50, 'invite_unknownCode1234');           ok('несуществующий код → 403', r.err === 403)
r = await tryLogin(10, 'invite_inviteCodeAAAA');            ok('ученик по приглашению', r.role === 'student' && r.studentId === 's1' && r.uid === 'tg:10')
ok('запись ученика привязана и активна', store.get('students/s1').tgId === 10 && store.get('students/s1').status === 'active' && store.get('students/s1').photoUrl === 'p10')
ok('приглашение помечено использованным', store.get('invites/inviteCodeAAAA').usedBy === 'tg:10')
ok('создан users/tg:10 с ролью student', store.get('users/tg:10')?.role === 'student' && store.get('users/tg:10')?.studentId === 's1')
r = await tryLogin(11, 'invite_inviteCodeAAAA');            ok('повторное использование ссылки другим аккаунтом → 403', r.err === 403)
r = await tryLogin(10);                                     ok('ученик заходит без ссылки', r.role === 'student' && r.studentId === 's1')
r = await tryLogin(10, '', { photo_url: 'NEW' });           ok('фото ученика обновляется в записи', store.get('students/s1').photoUrl === 'NEW')
r = await tryLogin(12, 'invite_inviteCodeBBBB');            ok('новое приглашение на ту же запись → привязан другой аккаунт', r.role === 'student' && store.get('students/s1').tgId === 12)
ok('старый аккаунт потерял доступ (users удалён)', !store.has('users/tg:10'))
r = await tryLogin(10);                                     ok('старый аккаунт → 403', r.err === 403)
store.set('students/s1', { ...store.get('students/s1'), archived: true })
r = await tryLogin(12);                                     ok('ученик в архиве → 403', r.err === 403)
store.set('students/s2', { name: 'Петя', archived: true }); store.set('invites/inviteCodeCCCC', { studentId: 's2' })
r = await tryLogin(13, 'invite_inviteCodeCCCC');            ok('приглашение на архивного → 403', r.err === 403)
r = await tryLogin(1);                                      ok('преподаватель входит как раньше', r.role === 'teacher')
process.exit(bad ? 1 : 0)
