// Firestore в памяти — только для тестов (node login.test.mjs, node students.test.mjs). В проде не используется.
export const store = new Map()
const clone = (o) => (o === undefined ? undefined : structuredClone(o))
const TS = { __ts: true }
let autoId = 0

class Snap {
  constructor(ref, d) { this.ref = ref; this.id = ref.id; this._d = d; this.exists = d !== undefined }
  get(f) { return this._d?.[f] }
  data() { return this._d }
}
const apply = (op, ref, d, o) => {
  if (op === 'set') store.set(ref.path, o?.merge ? { ...store.get(ref.path), ...d } : { ...d })
  if (op === 'update') { if (!store.has(ref.path)) throw new Error('update of missing doc ' + ref.path); store.set(ref.path, { ...store.get(ref.path), ...d }) }
  if (op === 'delete') store.delete(ref.path)
}
const mkRef = (c, id) => ({
  path: `${c}/${id}`, id,
  async get() { return new Snap(this, clone(store.get(this.path))) },
  async set(d, o) { apply('set', this, d, o) }, async update(d) { apply('update', this, d) }, async delete() { apply('delete', this) },
})
const query = (c, filters = []) => ({
  where: (f, op, v) => { if (op !== '==') throw new Error('fake: only =='); return query(c, [...filters, [f, v]]) },
  async get() {
    const docs = [...store.keys()].filter(k => k.startsWith(c + '/') && !k.slice(c.length + 1).includes('/'))
      .map(k => new Snap(mkRef(c, k.slice(c.length + 1)), clone(store.get(k)))).filter(s => filters.every(([f, v]) => s.get(f) === v))
    return { docs, size: docs.length }
  },
})

export const db = {
  collection: (c) => ({
    doc: (id) => mkRef(c, id),
    async add(d) { const ref = mkRef(c, `auto${++autoId}`); apply('set', ref, d); return ref },
    where: (f, op, v) => query(c).where(f, op, v),
  }),
  batch() {
    const w = []
    return { update: (r, d) => w.push(['update', r, d]), delete: (r) => w.push(['delete', r]), set: (r, d, o) => w.push(['set', r, d, o]),
      async commit() { for (const [op, r, d, o] of w) apply(op, r, d, o) } }
  },
  async runTransaction(fn) {
    const writes = []; let wrote = false
    const tx = {
      async get(ref) { if (wrote) throw new Error('read after write'); return new Snap(ref, clone(store.get(ref.path))) },
      set(ref, d, o) { wrote = true; writes.push(['set', ref, d, o]) },
      update(ref, d) { wrote = true; writes.push(['update', ref, d]) },
      delete(ref) { wrote = true; writes.push(['delete', ref]) },
    }
    await fn(tx)
    for (const [op, ref, d, o] of writes) apply(op, ref, d, o)
  },
}
export const FieldValue = { serverTimestamp: () => TS }
