import { randomUUID } from 'node:crypto';

type Row = Record<string, any>;

/** Tabela em memória com o subconjunto do Prisma que os serviços usam (igualdade, `in`, `not`, ordenação simples). */
export class FakeTable {
  rows: Row[] = [];
  constructor(private readonly defaults: () => Row = () => ({})) {}

  private match(r: Row, where: Row = {}): boolean {
    return Object.entries(where).every(([k, v]) => {
      if (k === 'OR') return (v as Row[]).some((w) => this.match(r, w));
      if (v && typeof v === 'object' && !(v instanceof Date)) {
        if ('in' in v) return (v as any).in.includes(r[k]);
        if ('not' in v) return r[k] !== (v as any).not && (v as any).not !== undefined ? (v as any).not === null ? r[k] != null : r[k] !== (v as any).not : true;
        if ('gte' in v) return r[k] >= (v as any).gte;
        return true;
      }
      return r[k] === v;
    });
  }

  async findMany(a: Row = {}) {
    let out = this.rows.filter((r) => this.match(r, a.where));
    const ob = Array.isArray(a.orderBy) ? a.orderBy[0] : a.orderBy;
    if (ob) {
      const [k, d] = Object.entries(ob)[0] as [string, any];
      const dir = typeof d === 'string' ? d : d.sort;
      out = [...out].sort((x, y) => (x[k] > y[k] ? 1 : x[k] < y[k] ? -1 : 0) * (dir === 'desc' ? -1 : 1));
    }
    if (a.take) out = out.slice(0, a.take);
    return out.map((r) => ({ ...r }));
  }
  async findFirst(a: Row = {}) { return (await this.findMany(a))[0] ?? null; }
  async findUnique(a: Row) { return this.findFirst(a); }
  async count(a: Row = {}) { return this.rows.filter((r) => this.match(r, a.where)).length; }
  async create({ data }: Row) {
    const row = { id: randomUUID(), created_at: new Date(Date.now() + this.rows.length), ...this.defaults(), ...data };
    this.rows.push(row);
    return { ...row };
  }
  async update({ where, data }: Row) {
    const r = this.rows.find((x) => this.match(x, where));
    if (!r) throw new Error('registro não encontrado');
    Object.assign(r, data);
    return { ...r };
  }
  async updateMany({ where, data }: Row) {
    const hit = this.rows.filter((x) => this.match(x, where));
    hit.forEach((r) => Object.assign(r, data));
    return { count: hit.length };
  }
  async delete({ where }: Row) {
    const i = this.rows.findIndex((x) => this.match(x, where));
    if (i < 0) throw new Error('registro não encontrado');
    return this.rows.splice(i, 1)[0];
  }
}
