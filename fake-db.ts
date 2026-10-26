// Firestore в памяти — только для тестов (npm test). В проде не используется. Типы нарочно простые: это имитация, а не копия API.
type Doc = Record<string, any>
export const store = new Map<string, any>()   // any: в тестах читаем поля как есть, без проверок
const clone = (o: Doc | undefined): Doc | undefined => (o === undefined ? undefined : structuredClone(o))
const TS = { __ts: true }
let autoId = 0

class Snap {
  id: string; exists: boolean
  constructor(public ref: Ref, public _d: Doc | undefined) { this.id = ref.id; this.exists = _d !== undefined }
  get(f: string) { return this._d?.[f] }
  data() { return this._d }
}
type Ref = { path: string; id: string; get(): Promise<Snap>; set(d: Doc, o?: { merge?: boolean }): Promise<void>; update(d: Doc): Promise<void>; delete(): Promise<void> }
type Op = 'set' | 'update' | 'delete'
const apply = (op: Op, ref: { path: string }, d?: Doc, o?: { merge?: boolean }) => {
  if (op === 'set') store.set(ref.path, o?.merge ? { ...store.get(ref.path), ...d } : { ...d })
  if (op === 'update') { if (!store.has(ref.path)) throw new Error('update of missing doc ' + ref.path); store.set(ref.path, { ...store.get(ref.path), ...d }) }
  if (op === 'delete') store.delete(ref.path)
}
const mkRef = (c: string, id: string): Ref => ({
  path: `${c}/${id}`, id,
  async get() { return new Snap(this, clone(store.get(this.path))) },
  async set(d, o) { apply('set', this, d, o) }, async update(d) { apply('update', this, d) }, async delete() { apply('delete', this) },
})
const query = (c: string, filters: [string, unknown][] = []): any => ({
  where: (f: string, op: string, v: unknown) => { if (op !== '==') throw new Error('fake: only =='); return query(c, [...filters, [f, v]]) },
  async get() {
    const docs = [...store.keys()].filter(k => k.startsWith(c + '/') && !k.slice(c.length + 1).includes('/'))
      .map(k => new Snap(mkRef(c, k.slice(c.length + 1)), clone(store.get(k)))).filter(s => filters.every(([f, v]) => s.get(f) === v))
    return { docs, size: docs.length }
  },
})

export const db: any = {
  collection: (c: string) => ({
    doc: (id?: string) => mkRef(c, id ?? `auto${++autoId}`),
    async add(d: Doc) { const ref = mkRef(c, `auto${++autoId}`); apply('set', ref, d); return ref },
    where: (f: string, op: string, v: unknown) => query(c).where(f, op, v),
    get: () => query(c).get(),
  }),
  batch() {
    const w: [Op, Ref, Doc?, { merge?: boolean }?][] = []
    return { update: (r: Ref, d: Doc) => w.push(['update', r, d]), delete: (r: Ref) => w.push(['delete', r]), set: (r: Ref, d: Doc, o?: { merge?: boolean }) => w.push(['set', r, d, o]),
      async commit() { for (const [op, r, d, o] of w) apply(op, r, d, o) } }
  },
  async runTransaction(fn: (tx: any) => Promise<unknown>) {
    const writes: [Op, Ref, Doc?, { merge?: boolean }?][] = []; let wrote = false
    const tx = {
      async get(ref: Ref) { if (wrote) throw new Error('read after write'); return new Snap(ref, clone(store.get(ref.path))) },
      set(ref: Ref, d: Doc, o?: { merge?: boolean }) { wrote = true; writes.push(['set', ref, d, o]) },
      update(ref: Ref, d: Doc) { wrote = true; writes.push(['update', ref, d]) },
      delete(ref: Ref) { wrote = true; writes.push(['delete', ref]) },
    }
    await fn(tx)
    for (const [op, ref, d, o] of writes) apply(op, ref, d, o)
  },
}
export const FieldValue: any = { serverTimestamp: () => TS }
