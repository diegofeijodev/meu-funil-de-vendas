# Migração dos dados do Lovable — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** levar os dados do Meu Funil do Lovable (Supabase) para a stack própria — exportação no Lovable, pull/ensaio/virada no EC2 com um importador que lê o JSON exportado.

**Architecture:** o Lovable ganha uma função SQL só-leitura com token e uma rota de arquivos (prompt pronto). Um `pull.mjs` baixa manifesto, tabelas e arquivos para `/opt/meu-funil/lovable-export/<data>`. Um importador avulso (`api/src/scripts/import-lovable/`, sem subir o Nest) roda num contêiner da imagem da API: carrega o JSON numa transação única, mapeia `auth.users` → `users`, reescreve os links do Storage com o segredo de produção, recifra credenciais, zera travas e trata vencidos; depois copia os arquivos; `--verify` confere tudo.

**Tech Stack:** NestJS 11 / TypeScript (script avulso), Prisma 5 (`$queryRawUnsafe` com identificadores validados), PostgreSQL 16, Node 22 (`fetch`, WebCrypto), jest, bash.

**Spec:** `docs/superpowers/specs/2026-10-06-migracao-lovable-design.md`

## Global Constraints

- Branch `feat/migracao-lovable` a partir da `master`; commits em pt-BR terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; `git add` só dos caminhos da tarefa; **não fazer push** (o dono envia via `!`).
- Máquina do dono: todo jest/typecheck/lint/e2e vai por `scripts/run-capped.sh 1500 <cmd>` (de `api/`: `../scripts/run-capped.sh`); um pesado por vez; nunca `nest build`/`next build`.
- Postgres local só para o e2e (`docker compose up -d postgres` na raiz) e parado no fim (`docker compose stop postgres`).
- Banco de teste do e2e: `meufunil_import_e2e` (nunca `meufunil`, nunca produção).
- SQL: nomes de tabela/coluna só depois de `quoteIdent` contra o `information_schema` do destino; valores sempre como parâmetro.
- Relatório/saída do importador: só contagens, ids, nomes de tabela/coluna e caminhos de arquivo — nunca valores de credencial, token, senha ou e-mail.
- Tabela pulada de propósito: `cron_tokens`. Buckets aceitos: `creative-assets`, `ig-media` (`BUCKETS` do `FilesService`).
- Mensagem dos posts vencidos: `O horário passou durante a mudança de sistema. Reagende pela tela.`; cadências vencidas há mais de 3 dias → `stopped` com `stop_reason` `Parada na mudança de sistema: o próximo passo venceu há mais de 3 dias.`
- Desvio consciente da spec: o relatório sai na saída do comando (linhas + `RELATORIO_JSON {...}`) e o runbook grava com `tee` na pasta da exportação, porque a pasta entra no contêiner só-leitura.

## Review Focus

1. Coluna NOT NULL no nosso schema que vem `null` em linhas reais do Lovable → o `--dry-run` tem de falhar dizendo tabela/coluna, sem gravar nada (Task 6: a carga é numa transação; o e2e prova que dry-run não grava).
2. Exportação inconsistente (linhas ≠ manifesto, tabela ausente) → aborta antes de gravar (Task 5 `readTable`; Task 6 e2e "exportação inconsistente").
3. Nome de arquivo com espaço/acento/codificado no link → reescrito pelo caminho decodificado (Task 4 unit + Task 6 e2e com `criativo ação.png`).
4. Credencial vazia ou já no nosso formato → não é recifrada nem acusada como ilegível (Task 6 e2e: `RESEND_API_KEY` vazia continua vazia; Task 7 verify não conta vazias).
5. E-mail repetido só por maiúsculas → aborta com os ids (Task 3 unit).

---

### Task 1: Decifrar credenciais `enc:v1` do protótipo

**Files:**
- Create: `api/src/scripts/import-lovable/legacy-crypto.ts`
- Test: `api/src/scripts/import-lovable/__tests__/legacy-crypto.spec.ts`

**Interfaces:**
- Produces: `LEGACY_PREFIX = 'enc:v1:'`, `OUR_PREFIX = 'enc:v2:'`, `isLegacyEncrypted(v: string): boolean`, `isOurEncrypted(v: string): boolean`, `decryptLegacy(value: string, secret: string): string` (lança em formato errado ou chave errada).

- [ ] **Step 1: Criar a branch e escrever o teste que falha**

```bash
cd /home/doutor/coding/freela/meu-funil && git checkout -b feat/migracao-lovable
```

`api/src/scripts/import-lovable/__tests__/legacy-crypto.spec.ts`:

```ts
import { webcrypto } from 'node:crypto';
import { decryptLegacy, isLegacyEncrypted, isOurEncrypted } from '../legacy-crypto';

/** Cifra exatamente como o protótipo (`src/lib/credentials.server.ts`): WebCrypto AES-GCM, chave = SHA-256 do segredo. */
async function encryptLikePrototype(value: string, secret: string): Promise<string> {
  const raw = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  const key = await webcrypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(value)));
  return `enc:v1:${Buffer.from(iv).toString('base64')}:${Buffer.from(ct).toString('base64')}`;
}

describe('decryptLegacy (enc:v1 do protótipo)', () => {
  it('decifra o que o protótipo cifrou, inclusive acentos', async () => {
    const v = await encryptLikePrototype('chave-secreta ção 123', 'segredo-do-lovable');
    expect(decryptLegacy(v, 'segredo-do-lovable')).toBe('chave-secreta ção 123');
  });

  it('chave errada lança (nunca devolve lixo)', async () => {
    const v = await encryptLikePrototype('x', 'certa');
    expect(() => decryptLegacy(v, 'errada')).toThrow();
  });

  it('formato errado lança', () => {
    expect(() => decryptLegacy('texto-puro', 's')).toThrow('fora do formato');
    expect(() => decryptLegacy('enc:v1:abc', 's')).toThrow('malformado');
    expect(() => decryptLegacy('enc:v1:AAAAAAAAAAAAAAAA:AAAA:extra', 's')).toThrow('malformado');
  });

  it('reconhece os prefixos', () => {
    expect(isLegacyEncrypted('enc:v1:a:b')).toBe(true);
    expect(isOurEncrypted('enc:v2:a:b:c')).toBe(true);
    expect(isLegacyEncrypted('enc:v2:a:b:c')).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd api && ../scripts/run-capped.sh 1500 npx jest src/scripts/import-lovable/__tests__/legacy-crypto.spec.ts`
Expected: FAIL — `Cannot find module '../legacy-crypto'`.

- [ ] **Step 3: Implementar**

`api/src/scripts/import-lovable/legacy-crypto.ts`:

```ts
import { createDecipheriv, createHash } from 'node:crypto';

/** Formato do protótipo (`src/lib/credentials.server.ts`): `enc:v1:<iv base64>:<cifrado+tag base64>`, AES-256-GCM, chave = SHA-256 do segredo. */
export const LEGACY_PREFIX = 'enc:v1:';
/** Formato do nosso cofre (`VaultService.encryptValue`). */
export const OUR_PREFIX = 'enc:v2:';

export const isLegacyEncrypted = (v: string): boolean => v.startsWith(LEGACY_PREFIX);
export const isOurEncrypted = (v: string): boolean => v.startsWith(OUR_PREFIX);

/** Decifra um valor `enc:v1` do protótipo. Lança se o formato estiver errado ou a chave não for a certa (a tag do GCM não confere). */
export function decryptLegacy(value: string, secret: string): string {
  if (!isLegacyEncrypted(value)) throw new Error('valor fora do formato enc:v1');
  const [ivB64, dataB64, extra] = value.slice(LEGACY_PREFIX.length).split(':');
  const iv = Buffer.from(ivB64 ?? '', 'base64');
  const data = Buffer.from(dataB64 ?? '', 'base64');
  if (extra !== undefined || iv.length !== 12 || data.length < 16) throw new Error('valor enc:v1 malformado');
  const key = createHash('sha256').update(secret, 'utf8').digest();
  const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  decipher.setAuthTag(data.subarray(data.length - 16));
  return Buffer.concat([decipher.update(data.subarray(0, data.length - 16)), decipher.final()]).toString('utf8');
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd api && ../scripts/run-capped.sh 1500 npx jest src/scripts/import-lovable/__tests__/legacy-crypto.spec.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add api/src/scripts/import-lovable/legacy-crypto.ts api/src/scripts/import-lovable/__tests__/legacy-crypto.spec.ts
git commit -m "feat(migracao): decifra as credenciais enc:v1 do protótipo do Lovable

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Plano de colunas e identificadores SQL seguros

**Files:**
- Create: `api/src/scripts/import-lovable/columns.ts`
- Test: `api/src/scripts/import-lovable/__tests__/columns.spec.ts`

**Interfaces:**
- Produces: `type TargetColumn = { name: string; nullable: boolean; hasDefault: boolean; generated: boolean }`, `type ColumnPlan = { insert: string[]; sourceOnly: string[]; missingRequired: string[] }`, `planColumns(rows: Record<string, unknown>[], target: TargetColumn[]): ColumnPlan`, `quoteIdent(name: string, allowed: ReadonlySet<string>): string`.

- [ ] **Step 1: Escrever o teste que falha**

`api/src/scripts/import-lovable/__tests__/columns.spec.ts`:

```ts
import { planColumns, quoteIdent, TargetColumn } from '../columns';

const col = (name: string, o: Partial<TargetColumn> = {}): TargetColumn => ({ name, nullable: true, hasDefault: false, generated: false, ...o });

describe('planColumns', () => {
  const target = [
    col('id', { nullable: false, hasDefault: true }),
    col('name', { nullable: false }),
    col('note'),
    col('total', { generated: true }),
    col('created_at', { nullable: false, hasDefault: true }),
  ];

  it('insere a interseção, sem as geradas, na ordem do destino', () => {
    expect(planColumns([{ name: 'a', id: '1', total: 3, note: null }], target).insert).toEqual(['id', 'name', 'note']);
  });

  it('coluna só da origem vira "dado não migrado"', () => {
    expect(planColumns([{ id: '1', name: 'a', legado: 1 }, { id: '2', name: 'b', outro: 2 }], target).sourceOnly).toEqual(['legado', 'outro']);
  });

  it('obrigatória sem default ausente na origem é apontada (só se houver linhas)', () => {
    expect(planColumns([{ id: '1' }], target).missingRequired).toEqual(['name']);
    expect(planColumns([], target).missingRequired).toEqual([]);
  });
});

describe('quoteIdent', () => {
  const ok = new Set(['brands', 'logo_url']);

  it('põe aspas só em nomes permitidos', () => {
    expect(quoteIdent('logo_url', ok)).toBe('"logo_url"');
  });

  it('recusa nome fora da lista ou com caracteres perigosos', () => {
    expect(() => quoteIdent('users', ok)).toThrow('não permitido');
    const evil = 'brands"; drop table x; --';
    expect(() => quoteIdent(evil, new Set([evil]))).toThrow('não permitido');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd api && ../scripts/run-capped.sh 1500 npx jest src/scripts/import-lovable/__tests__/columns.spec.ts`
Expected: FAIL — `Cannot find module '../columns'`.

- [ ] **Step 3: Implementar**

`api/src/scripts/import-lovable/columns.ts`:

```ts
export type TargetColumn = { name: string; nullable: boolean; hasDefault: boolean; generated: boolean };
export type ColumnPlan = { insert: string[]; sourceOnly: string[]; missingRequired: string[] };

const IDENT = /^[a-z_][a-z0-9_]*$/;

/** Colunas do INSERT = chaves presentes nas linhas exportadas ∩ colunas não geradas do destino (na ordem do destino). */
export function planColumns(rows: Record<string, unknown>[], target: TargetColumn[]): ColumnPlan {
  const source = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) source.add(k);
  const known = new Set(target.map((c) => c.name));
  return {
    insert: target.filter((c) => !c.generated && source.has(c.name)).map((c) => c.name),
    sourceOnly: [...source].filter((k) => !known.has(k)).sort(),
    missingRequired: rows.length
      ? target.filter((c) => !c.generated && !c.nullable && !c.hasDefault && !source.has(c.name)).map((c) => c.name)
      : [],
  };
}

/** Identificador SQL entre aspas — só se estiver na lista de permissão (vinda do information_schema do destino). */
export function quoteIdent(name: string, allowed: ReadonlySet<string>): string {
  if (!IDENT.test(name) || !allowed.has(name)) throw new Error(`identificador não permitido: ${JSON.stringify(name)}`);
  return `"${name}"`;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd api && ../scripts/run-capped.sh 1500 npx jest src/scripts/import-lovable/__tests__/columns.spec.ts`
Expected: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add api/src/scripts/import-lovable/columns.ts api/src/scripts/import-lovable/__tests__/columns.spec.ts
git commit -m "feat(migracao): plano de colunas da carga e identificadores SQL só da lista do destino

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Contas — `auth.users` + `auth.identities` → `users`

**Files:**
- Create: `api/src/scripts/import-lovable/auth-map.ts`
- Test: `api/src/scripts/import-lovable/__tests__/auth-map.spec.ts`

**Interfaces:**
- Produces: `type AuthUser = { id: string; email: string | null; encrypted_password: string | null; created_at: string; deleted_at?: string | null; banned_until?: string | null; is_anonymous?: boolean | null }`, `type AuthIdentity = { user_id: string; provider: string; provider_id?: string | null; identity_data?: { sub?: string } | null }`, `type UserRow = { id: string; email: string; password_hash: string | null; google_sub: string | null; token_version: number; created_at: string }`, `type SkipReason = 'apagada' | 'banida' | 'anonima' | 'sem_email'`, `type UsersPlan = { users: UserRow[]; skipped: { id: string; reason: SkipReason }[]; noLogin: string[]; nonBcrypt: string[] }`, `class DuplicateEmailError extends Error { ids: string[][] }`, `mapUsers(authUsers: AuthUser[], identities: AuthIdentity[], now: Date): UsersPlan`.

- [ ] **Step 1: Escrever o teste que falha**

`api/src/scripts/import-lovable/__tests__/auth-map.spec.ts`:

```ts
import { compareSync, hashSync } from 'bcryptjs';
import { AuthUser, DuplicateEmailError, mapUsers } from '../auth-map';

const now = new Date('2026-10-06T12:00:00Z');
const u = (id: string, o: Partial<AuthUser> = {}): AuthUser => ({ id, email: `${id}@x.com`, encrypted_password: '', created_at: '2026-01-01T00:00:00Z', ...o });

describe('mapUsers', () => {
  it('mantém id, e-mail em minúsculas e o hash bcrypt do Supabase (a senha atual continua valendo)', () => {
    const hash = hashSync('senha-atual', 4).replace(/^\$2b\$/, '$2a$');
    const p = mapUsers([u('a', { email: '  Dono@Exemplo.COM ', encrypted_password: hash })], [], now);
    expect(p.users).toEqual([{ id: 'a', email: 'dono@exemplo.com', password_hash: hash, google_sub: null, token_version: 0, created_at: '2026-01-01T00:00:00Z' }]);
    expect(compareSync('senha-atual', p.users[0]!.password_hash!)).toBe(true);
    expect(p.noLogin).toEqual([]);
  });

  it('liga o Google pelo provider_id (ou identity_data.sub) e ignora outros provedores', () => {
    const p = mapUsers(
      [u('g1'), u('g2'), u('e1')],
      [
        { user_id: 'g1', provider: 'google', provider_id: '111' },
        { user_id: 'g2', provider: 'google', provider_id: null, identity_data: { sub: '222' } },
        { user_id: 'e1', provider: 'email', provider_id: 'e1' },
      ],
      now,
    );
    expect(p.users.map((x) => [x.id, x.google_sub])).toEqual([['g1', '111'], ['g2', '222'], ['e1', null]]);
    expect(p.noLogin).toEqual(['e1']);
  });

  it('hash que não é bcrypt não vira senha: entra no relatório', () => {
    const p = mapUsers([u('a', { encrypted_password: 'md5:abc' })], [], now);
    expect(p.users[0]!.password_hash).toBeNull();
    expect(p.nonBcrypt).toEqual(['a']);
    expect(p.noLogin).toEqual(['a']);
  });

  it('apagada, banida (ainda valendo), anônima e sem e-mail ficam de fora; banimento vencido entra', () => {
    const p = mapUsers(
      [
        u('del', { deleted_at: '2026-09-01T00:00:00Z' }),
        u('ban', { banned_until: '2027-01-01T00:00:00Z' }),
        u('old', { banned_until: '2026-01-01T00:00:00Z', encrypted_password: '$2a$10$' + 'x'.repeat(53) }),
        u('anon', { is_anonymous: true }),
        u('noemail', { email: '  ' }),
      ],
      [],
      now,
    );
    expect(p.users.map((x) => x.id)).toEqual(['old']);
    expect(p.skipped).toEqual([
      { id: 'del', reason: 'apagada' },
      { id: 'ban', reason: 'banida' },
      { id: 'anon', reason: 'anonima' },
      { id: 'noemail', reason: 'sem_email' },
    ]);
  });

  it('e-mail repetido (sem diferenciar maiúsculas) aborta com os ids', () => {
    try {
      mapUsers([u('a', { email: 'X@y.com' }), u('b', { email: 'x@Y.com' }), u('c')], [], now);
      throw new Error('não abortou');
    } catch (e) {
      expect(e).toBeInstanceOf(DuplicateEmailError);
      expect((e as DuplicateEmailError).ids).toEqual([['a', 'b']]);
    }
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd api && ../scripts/run-capped.sh 1500 npx jest src/scripts/import-lovable/__tests__/auth-map.spec.ts`
Expected: FAIL — `Cannot find module '../auth-map'`.

- [ ] **Step 3: Implementar**

`api/src/scripts/import-lovable/auth-map.ts`:

```ts
export type AuthUser = {
  id: string;
  email: string | null;
  encrypted_password: string | null;
  created_at: string;
  deleted_at?: string | null;
  banned_until?: string | null;
  is_anonymous?: boolean | null;
};
export type AuthIdentity = { user_id: string; provider: string; provider_id?: string | null; identity_data?: { sub?: string } | null };
export type UserRow = { id: string; email: string; password_hash: string | null; google_sub: string | null; token_version: number; created_at: string };
export type SkipReason = 'apagada' | 'banida' | 'anonima' | 'sem_email';
export type UsersPlan = { users: UserRow[]; skipped: { id: string; reason: SkipReason }[]; noLogin: string[]; nonBcrypt: string[] };

export class DuplicateEmailError extends Error {
  constructor(readonly ids: string[][]) {
    super(`e-mails repetidos (sem diferenciar maiúsculas) em ${ids.length} grupo(s) de contas: ${ids.map((g) => g.join('+')).join(', ')}. Nada foi gravado.`);
  }
}

/** Hash do GoTrue (bcrypt): `$2a$`/`$2b$`/`$2y$` — o `bcryptjs` da nossa API confere os três. */
const BCRYPT = /^\$2[aby]\$\d{2}\$/;

/** Contas do Supabase → tabela `users` (mesmo id do `profiles`). Contas apagadas/banidas/anônimas ficam de fora. */
export function mapUsers(authUsers: AuthUser[], identities: AuthIdentity[], now: Date): UsersPlan {
  const google = new Map<string, string>();
  for (const i of identities) {
    if (i.provider !== 'google') continue;
    const sub = i.provider_id || i.identity_data?.sub;
    if (sub) google.set(i.user_id, String(sub));
  }
  const out: UsersPlan = { users: [], skipped: [], noLogin: [], nonBcrypt: [] };
  for (const u of authUsers) {
    if (u.deleted_at) { out.skipped.push({ id: u.id, reason: 'apagada' }); continue; }
    if (u.banned_until && new Date(u.banned_until).getTime() > now.getTime()) { out.skipped.push({ id: u.id, reason: 'banida' }); continue; }
    if (u.is_anonymous) { out.skipped.push({ id: u.id, reason: 'anonima' }); continue; }
    const email = (u.email ?? '').trim().toLowerCase();
    if (!email) { out.skipped.push({ id: u.id, reason: 'sem_email' }); continue; }
    const password = u.encrypted_password && BCRYPT.test(u.encrypted_password) ? u.encrypted_password : null;
    if (u.encrypted_password && !password) out.nonBcrypt.push(u.id);
    const sub = google.get(u.id) ?? null;
    if (!password && !sub) out.noLogin.push(u.id);
    out.users.push({ id: u.id, email, password_hash: password, google_sub: sub, token_version: 0, created_at: u.created_at });
  }
  const byEmail = new Map<string, string[]>();
  for (const x of out.users) byEmail.set(x.email, [...(byEmail.get(x.email) ?? []), x.id]);
  const dups = [...byEmail.values()].filter((ids) => ids.length > 1);
  if (dups.length) throw new DuplicateEmailError(dups);
  return out;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd api && ../scripts/run-capped.sh 1500 npx jest src/scripts/import-lovable/__tests__/auth-map.spec.ts`
Expected: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add api/src/scripts/import-lovable/auth-map.ts api/src/scripts/import-lovable/__tests__/auth-map.spec.ts
git commit -m "feat(migracao): contas do Supabase viram users com a mesma senha bcrypt e o Google ligado

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Reescrita dos links do Storage (texto e JSON)

**Files:**
- Create: `api/src/scripts/import-lovable/storage-links.ts`
- Test: `api/src/scripts/import-lovable/__tests__/storage-links.spec.ts`

**Interfaces:**
- Produces: `STORAGE_LIKE = '%.supabase.co/storage/v1/%'`, `type LinkResolver = (bucket: string, key: string) => string | null`, `type MissingFile = { bucket: string; key: string }`, `rewriteLinks<T>(value: T, resolve: LinkResolver): { value: T; changed: number; missing: MissingFile[] }`.

- [ ] **Step 1: Escrever o teste que falha**

`api/src/scripts/import-lovable/__tests__/storage-links.spec.ts`:

```ts
import { rewriteLinks, STORAGE_LIKE } from '../storage-links';

const SB = 'https://abcdefghijklmnop.supabase.co/storage/v1/object';
const known = new Set(['creative-assets/brands/w1/logo.png', 'creative-assets/2026-09-30/criativo ação.png', 'ig-media/posts/w1/p1.jpg']);
const resolve = (b: string, k: string) => (known.has(`${b}/${k}`) ? `https://api.test/v1/files/${b}/${encodeURI(k)}?exp=1&sig=s` : null);

describe('rewriteLinks', () => {
  it('URL assinada (com ?token) e pública viram o link nosso', () => {
    expect(rewriteLinks(`${SB}/sign/creative-assets/brands/w1/logo.png?token=eyJ.abc`, resolve)).toEqual({
      value: 'https://api.test/v1/files/creative-assets/brands/w1/logo.png?exp=1&sig=s',
      changed: 1,
      missing: [],
    });
    expect(rewriteLinks(`${SB}/public/ig-media/posts/w1/p1.jpg`, resolve).value).toBe('https://api.test/v1/files/ig-media/posts/w1/p1.jpg?exp=1&sig=s');
  });

  it('decodifica o caminho (espaço e acento) antes de procurar o arquivo', () => {
    const r = rewriteLinks(`${SB}/sign/creative-assets/2026-09-30/criativo%20a%C3%A7%C3%A3o.png?token=x`, resolve);
    expect(r.changed).toBe(1);
    expect(r.value).toBe('https://api.test/v1/files/creative-assets/2026-09-30/criativo%20a%C3%A7%C3%A3o.png?exp=1&sig=s');
  });

  it('percorre JSON aninhado e mantém o resto intacto', () => {
    const input = { n: 1, ok: true, nada: null, media: [{ url: `${SB}/sign/ig-media/posts/w1/p1.jpg?token=t`, alt: 'foto' }], txt: 'sem link' };
    const r = rewriteLinks(input, resolve);
    expect(r.changed).toBe(1);
    expect(r.value).toEqual({ ...input, media: [{ url: 'https://api.test/v1/files/ig-media/posts/w1/p1.jpg?exp=1&sig=s', alt: 'foto' }] });
  });

  it('vários links num texto (markdown): o ")" não entra no caminho', () => {
    const s = `![a](${SB}/public/ig-media/posts/w1/p1.jpg) e ![b](${SB}/sign/creative-assets/brands/w1/logo.png?token=z)`;
    const r = rewriteLinks(s, resolve);
    expect(r.changed).toBe(2);
    expect(r.value).toBe(
      '![a](https://api.test/v1/files/ig-media/posts/w1/p1.jpg?exp=1&sig=s) e ![b](https://api.test/v1/files/creative-assets/brands/w1/logo.png?exp=1&sig=s)',
    );
  });

  it('arquivo que não veio na exportação: link mantido e listado', () => {
    const url = `${SB}/sign/creative-assets/sumiu/x.png?token=q`;
    expect(rewriteLinks(url, resolve)).toEqual({ value: url, changed: 0, missing: [{ bucket: 'creative-assets', key: 'sumiu/x.png' }] });
  });

  it('outras URLs do Supabase e textos comuns não mudam', () => {
    const s = 'https://abcdefghijklmnop.supabase.co/rest/v1/brands?select=*';
    expect(rewriteLinks(s, resolve)).toEqual({ value: s, changed: 0, missing: [] });
    expect(rewriteLinks(42, resolve)).toEqual({ value: 42, changed: 0, missing: [] });
  });

  it('o padrão LIKE pega as URLs do Storage', () => {
    expect(STORAGE_LIKE).toBe('%.supabase.co/storage/v1/%');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd api && ../scripts/run-capped.sh 1500 npx jest src/scripts/import-lovable/__tests__/storage-links.spec.ts`
Expected: FAIL — `Cannot find module '../storage-links'`.

- [ ] **Step 3: Implementar**

`api/src/scripts/import-lovable/storage-links.ts`:

```ts
/** Linhas candidatas no SQL (`coluna::text LIKE`). */
export const STORAGE_LIKE = '%.supabase.co/storage/v1/%';

/**
 * URL do Storage do Lovable/Supabase: `https://<ref>.supabase.co/storage/v1/object/(sign|public|authenticated)/<bucket>/<caminho>[?query]`.
 * O caminho para em `?`, `#`, aspas, espaço, `<`, `>`, `\` e `)` (link em markdown); um caminho cortado errado não acha arquivo e fica listado.
 */
const STORAGE_URL = /https:\/\/[a-z0-9]+\.supabase\.co\/storage\/v1\/object\/(?:sign|public|authenticated)\/([A-Za-z0-9_-]+)\/([^?#"'\s<>\\)]+)(?:\?[^#"'\s<>\\)]*)?/g;

export type LinkResolver = (bucket: string, key: string) => string | null;
export type MissingFile = { bucket: string; key: string };

function decodeKey(raw: string): string | null {
  try {
    return raw.split('/').map((s) => decodeURIComponent(s)).join('/');
  } catch {
    return null;
  }
}

/** Troca toda URL do Storage do Lovable pela nossa (via `resolve`); o que não resolve fica como está e é listado. Percorre JSON aninhado. */
export function rewriteLinks<T>(value: T, resolve: LinkResolver): { value: T; changed: number; missing: MissingFile[] } {
  let changed = 0;
  const missing: MissingFile[] = [];
  const inString = (s: string) =>
    s.replace(STORAGE_URL, (full: string, bucket: string, rawKey: string) => {
      const key = decodeKey(rawKey);
      const url = key ? resolve(bucket, key) : null;
      if (!url) {
        missing.push({ bucket, key: key ?? rawKey });
        return full;
      }
      changed++;
      return url;
    });
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return inString(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return { value: walk(value) as T, changed, missing };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd api && ../scripts/run-capped.sh 1500 npx jest src/scripts/import-lovable/__tests__/storage-links.spec.ts`
Expected: PASS (7 testes).

- [ ] **Step 5: Commit**

```bash
git add api/src/scripts/import-lovable/storage-links.ts api/src/scripts/import-lovable/__tests__/storage-links.spec.ts
git commit -m "feat(migracao): reescreve os links do Storage do Lovable (texto e JSON aninhado) para os links assinados da API

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Leitura da exportação, cópia de arquivos, relatório e argumentos

**Files:**
- Create: `api/src/scripts/import-lovable/export-reader.ts`, `copy-files.ts`, `report.ts`, `cli.ts`
- Test: `api/src/scripts/import-lovable/__tests__/export-reader.spec.ts`, `report-cli.spec.ts`

**Interfaces:**
- Consumes: `FilesService` (`api/src/modules/files/files.service.ts`): `resolvePath(bucket, key): string` (lança em chave inválida).
- Produces:
  - `type ManifestObject = { bucket_id: string; name: string; size: number | null }`, `type Manifest = { counts: Record<string, number>; buckets: { id: string; public: boolean }[]; objects: ManifestObject[] }`, `readManifest(dir): Manifest`, `tableKeys(m): { schema: string; table: string; count: number }[]`, `readTable(dir, schema, table): Record<string, unknown>[]`, `exportedFilePath(dir, bucket, name): string`, `assertObjects(dir, m, buckets: readonly string[]): void`.
  - `type FileTarget = { resolvePath(bucket: string, key: string): string }`, `copyExportedFiles(dir, m, files: FileTarget): Promise<{ copied: number; skipped: number }>`.
  - `type Mode = 'import' | 'dry-run' | 'verify' | 'only-files'`, `type ImportReport` (abaixo), `emptyReport(mode, database): ImportReport`, `formatReport(r): string[]`.
  - `type CliArgs = { exportDir: string; expectDb: string; uploadsDir: string; mode: Mode; skipCredentials: boolean }`, `parseArgs(argv: string[]): CliArgs`.

- [ ] **Step 1: Escrever os testes que falham**

`api/src/scripts/import-lovable/__tests__/export-reader.spec.ts`:

```ts
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FilesService } from '../../../modules/files/files.service';
import { copyExportedFiles } from '../copy-files';
import { assertObjects, exportedFilePath, Manifest, readManifest, readTable, tableKeys } from '../export-reader';

const BUCKETS = ['creative-assets', 'ig-media'];
const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'lovexp-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function fixture() {
  const dir = tmp();
  const m: Manifest = {
    counts: { 'public.brands': 1, 'auth.users': 0 },
    buckets: [{ id: 'creative-assets', public: false }],
    objects: [{ bucket_id: 'creative-assets', name: 'brands/w1/logo.png', size: 4 }],
  };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(m));
  mkdirSync(join(dir, 'tables'));
  writeFileSync(join(dir, 'tables', 'public.brands.json'), JSON.stringify([{ id: 'b1' }]));
  mkdirSync(join(dir, 'storage', 'creative-assets', 'brands', 'w1'), { recursive: true });
  writeFileSync(join(dir, 'storage', 'creative-assets', 'brands', 'w1', 'logo.png'), 'LOGO');
  return { dir, m };
}

describe('export-reader', () => {
  it('lê manifesto, chaves e tabelas', () => {
    const { dir } = fixture();
    const m = readManifest(dir);
    expect(tableKeys(m)).toEqual([{ schema: 'public', table: 'brands', count: 1 }, { schema: 'auth', table: 'users', count: 0 }]);
    expect(readTable(dir, 'public', 'brands')).toEqual([{ id: 'b1' }]);
  });

  it('tabela ausente na pasta aborta', () => {
    const { dir } = fixture();
    expect(() => readTable(dir, 'public', 'nao_existe')).toThrow('falta tables/public.nao_existe.json');
  });

  it('caminho que tenta sair da pasta aborta', () => {
    const { dir } = fixture();
    expect(() => exportedFilePath(dir, 'creative-assets', '../../etc/passwd')).toThrow('caminho de arquivo inválido');
  });

  it('bucket fora do previsto aborta', () => {
    const { dir, m } = fixture();
    m.objects.push({ bucket_id: 'avatars', name: 'a.png', size: 1 });
    expect(() => assertObjects(dir, m, BUCKETS)).toThrow('buckets fora do previsto na exportação: avatars');
  });

  it('arquivo com tamanho diferente do manifesto aborta', () => {
    const { dir, m } = fixture();
    m.objects[0]!.size = 99;
    expect(() => assertObjects(dir, m, BUCKETS)).toThrow('ausentes ou com tamanho diferente');
  });
});

describe('copyExportedFiles', () => {
  const filesFor = (up: string) => new FilesService({ UPLOADS_DIR: up, JWT_SECRET: 'segredo-de-teste-123456', PUBLIC_URL: 'https://api.test' } as never);

  it('copia para UPLOADS_DIR/<bucket>/<chave> e é idempotente', async () => {
    const { dir, m } = fixture();
    const up = tmp();
    expect(await copyExportedFiles(dir, m, filesFor(up))).toEqual({ copied: 1, skipped: 0 });
    expect(readFileSync(join(up, 'creative-assets', 'brands', 'w1', 'logo.png'), 'utf8')).toBe('LOGO');
    expect(await copyExportedFiles(dir, m, filesFor(up))).toEqual({ copied: 0, skipped: 1 });
  });

  it('chave que o FilesService recusa aborta', async () => {
    const { dir, m } = fixture();
    m.objects[0]!.name = 'brands//logo.png';
    await expect(copyExportedFiles(dir, m, filesFor(tmp()))).rejects.toThrow('Chave de arquivo inválida');
  });
});
```

`api/src/scripts/import-lovable/__tests__/report-cli.spec.ts`:

```ts
import { parseArgs } from '../cli';
import { emptyReport, formatReport } from '../report';

describe('formatReport', () => {
  it('resume a carga em linhas pt-BR com as contagens', () => {
    const r = emptyReport('dry-run', 'meufunil_stage');
    r.tables.push({ table: 'brands', rows: 2, sourceOnly: ['coluna_velha'] });
    r.users.imported = 3;
    r.links.changed = 4;
    r.links.missing = Array.from({ length: 22 }, (_, i) => ({ bucket: 'creative-assets', key: `f${i}.png` }));
    r.credentials.reencrypted = 1;
    const text = formatReport(r).join('\n');
    expect(text).toContain('modo: dry-run · banco: meufunil_stage');
    expect(text).toContain('tabelas carregadas: 1 (2 linhas)');
    expect(text).toContain('dado não migrado em brands: coluna_velha');
    expect(text).toContain('contas: 3 importadas');
    expect(text).toContain('links do Lovable reescritos: 4; mantidos (arquivo não exportado): 22');
    expect(text).toContain('(+2)');
    expect(text).toContain('arquivos: não copiados (dry-run)');
  });
});

describe('parseArgs', () => {
  const base = ['--export', '/import/x', '--expect-db', 'meufunil_stage', '--uploads-dir', '/data/u'];

  it('lê as opções e o modo', () => {
    expect(parseArgs(base)).toEqual({ exportDir: '/import/x', expectDb: 'meufunil_stage', uploadsDir: '/data/u', mode: 'import', skipCredentials: false });
    expect(parseArgs([...base, '--dry-run', '--skip-credentials'])).toMatchObject({ mode: 'dry-run', skipCredentials: true });
    expect(parseArgs([...base, '--verify']).mode).toBe('verify');
    expect(parseArgs([...base, '--only-files']).mode).toBe('only-files');
  });

  it('recusa falta de opção, modos juntos e opção desconhecida', () => {
    expect(() => parseArgs(['--export', '/x'])).toThrow('uso:');
    expect(() => parseArgs([...base, '--dry-run', '--verify'])).toThrow('escolha só um');
    expect(() => parseArgs([...base, '--forca'])).toThrow('opção desconhecida: --forca');
    expect(() => parseArgs(['--export', '--expect-db', 'x', '--uploads-dir', 'y'])).toThrow('--export precisa de um valor');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd api && ../scripts/run-capped.sh 1500 npx jest src/scripts/import-lovable/__tests__/export-reader.spec.ts src/scripts/import-lovable/__tests__/report-cli.spec.ts`
Expected: FAIL — `Cannot find module '../copy-files'` / `'../cli'`.

- [ ] **Step 3: Implementar**

`api/src/scripts/import-lovable/export-reader.ts`:

```ts
import { existsSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';

export type ManifestObject = { bucket_id: string; name: string; size: number | null };
export type Manifest = { counts: Record<string, number>; buckets: { id: string; public: boolean }[]; objects: ManifestObject[] };

/** `manifest.json` gravado pelo `pull.mjs`. */
export function readManifest(dir: string): Manifest {
  const m = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as Manifest;
  if (!m || typeof m.counts !== 'object' || !Array.isArray(m.objects)) throw new Error('manifest.json inválido');
  return m;
}

/** `public.<tabela>` / `auth.<tabela>` do manifesto, com a contagem esperada. */
export function tableKeys(m: Manifest): { schema: string; table: string; count: number }[] {
  return Object.entries(m.counts).map(([k, count]) => {
    const [schema, table] = k.split('.');
    return { schema: schema ?? '', table: table ?? '', count };
  });
}

export function readTable(dir: string, schema: string, table: string): Record<string, unknown>[] {
  const file = path.join(dir, 'tables', `${schema}.${table}.json`);
  if (!existsSync(file)) throw new Error(`exportação incompleta: falta tables/${schema}.${table}.json`);
  const rows = JSON.parse(readFileSync(file, 'utf8')) as unknown;
  if (!Array.isArray(rows)) throw new Error(`tables/${schema}.${table}.json não é uma lista`);
  return rows as Record<string, unknown>[];
}

/** Caminho do arquivo exportado, sem sair de `<dir>/storage/<bucket>`. */
export function exportedFilePath(dir: string, bucket: string, name: string): string {
  const base = path.resolve(dir, 'storage', bucket);
  const full = path.resolve(base, name);
  if (!name || !bucket || bucket.includes('/') || bucket.includes('..') || !full.startsWith(base + path.sep)) {
    throw new Error(`caminho de arquivo inválido na exportação: ${bucket}/${name}`);
  }
  return full;
}

/** Todo objeto do manifesto está num bucket conhecido e foi baixado com o tamanho certo. */
export function assertObjects(dir: string, m: Manifest, buckets: readonly string[]): void {
  const unknown = [...new Set(m.objects.map((o) => o.bucket_id).filter((b) => !buckets.includes(b)))];
  if (unknown.length) throw new Error(`buckets fora do previsto na exportação: ${unknown.join(', ')} (só ${buckets.join(', ')})`);
  const bad: string[] = [];
  for (const o of m.objects) {
    const p = exportedFilePath(dir, o.bucket_id, o.name);
    if (!existsSync(p) || (o.size != null && statSync(p).size !== Number(o.size))) bad.push(`${o.bucket_id}/${o.name}`);
  }
  if (bad.length) throw new Error(`${bad.length} arquivo(s) da exportação ausentes ou com tamanho diferente: ${bad.slice(0, 10).join(', ')}`);
}
```

`api/src/scripts/import-lovable/copy-files.ts`:

```ts
import { copyFile, mkdir, stat } from 'node:fs/promises';
import * as path from 'node:path';
import { exportedFilePath, Manifest } from './export-reader';

export type FileTarget = { resolvePath(bucket: string, key: string): string };

/** Copia os arquivos exportados para UPLOADS_DIR/<bucket>/<chave> (contenção do FilesService). Idempotente: pula o que já está com o mesmo tamanho. */
export async function copyExportedFiles(dir: string, m: Manifest, files: FileTarget): Promise<{ copied: number; skipped: number }> {
  let copied = 0;
  let skipped = 0;
  for (const o of m.objects) {
    const src = exportedFilePath(dir, o.bucket_id, o.name);
    const dest = files.resolvePath(o.bucket_id, o.name);
    const [s, d] = await Promise.all([stat(src), stat(dest).catch(() => null)]);
    if (d && d.size === s.size) {
      skipped++;
      continue;
    }
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(src, dest);
    copied++;
  }
  return { copied, skipped };
}
```

`api/src/scripts/import-lovable/report.ts`:

```ts
import { MissingFile } from './storage-links';

export type Mode = 'import' | 'dry-run' | 'verify' | 'only-files';

/** Só contagens, ids, nomes e caminhos — nunca valores de credencial, token, senha ou e-mail. */
export type ImportReport = {
  mode: Mode;
  database: string;
  tables: { table: string; rows: number; sourceOnly: string[] }[];
  skippedTables: string[];
  users: { imported: number; skipped: { id: string; reason: string }[]; noLogin: string[]; nonBcrypt: string[] };
  links: { changed: number; missing: MissingFile[] };
  credentials: { reencrypted: number; encryptedPlain: number; skippedLegacy: number; connectionsEncrypted: number };
  overdue: { jobsCancelled: number; postsFailed: number; cadencesKept: number; cadencesStopped: number; otherPending: { table: string; count: number }[] };
  leasesCleared: number;
  files: { copied: number; skipped: number } | null;
};

export function emptyReport(mode: Mode, database: string): ImportReport {
  return {
    mode,
    database,
    tables: [],
    skippedTables: [],
    users: { imported: 0, skipped: [], noLogin: [], nonBcrypt: [] },
    links: { changed: 0, missing: [] },
    credentials: { reencrypted: 0, encryptedPlain: 0, skippedLegacy: 0, connectionsEncrypted: 0 },
    overdue: { jobsCancelled: 0, postsFailed: 0, cadencesKept: 0, cadencesStopped: 0, otherPending: [] },
    leasesCleared: 0,
    files: null,
  };
}

const list = (xs: string[], max = 20) => (xs.length <= max ? xs.join(', ') : `${xs.slice(0, max).join(', ')} (+${xs.length - max})`);

export function formatReport(r: ImportReport): string[] {
  const out = [`modo: ${r.mode} · banco: ${r.database}`];
  out.push(`tabelas carregadas: ${r.tables.length} (${r.tables.reduce((n, t) => n + t.rows, 0)} linhas)`);
  for (const t of r.tables) if (t.sourceOnly.length) out.push(`  dado não migrado em ${t.table}: ${list(t.sourceOnly)}`);
  if (r.skippedTables.length) out.push(`tabelas puladas de propósito: ${list(r.skippedTables)}`);
  const u = r.users;
  out.push(`contas: ${u.imported} importadas; ${u.skipped.length} de fora${u.skipped.length ? ` (${list(u.skipped.map((s) => `${s.id}:${s.reason}`))})` : ''}`);
  if (u.noLogin.length) out.push(`  sem senha nem Google (só entram com login Google configurado): ${u.noLogin.length} — ${list(u.noLogin)}`);
  if (u.nonBcrypt.length) out.push(`  hash de senha fora do bcrypt: ${u.nonBcrypt.length} — ${list(u.nonBcrypt)}`);
  out.push(`links do Lovable reescritos: ${r.links.changed}; mantidos (arquivo não exportado): ${r.links.missing.length}`);
  if (r.links.missing.length) out.push(`  ${list(r.links.missing.map((m) => `${m.bucket}/${m.key}`))}`);
  const c = r.credentials;
  out.push(`credenciais: ${c.reencrypted} recifradas (enc:v1→enc:v2), ${c.encryptedPlain} cifradas (texto puro), ${c.skippedLegacy} não importadas; tokens de conexões cifrados: ${c.connectionsEncrypted}`);
  out.push(`travas zeradas: ${r.leasesCleared}`);
  const o = r.overdue;
  out.push(`vencidos: ${o.jobsCancelled} publicação(ões) cancelada(s), ${o.postsFailed} post(s) com falha; cadências: ${o.cadencesKept} seguem, ${o.cadencesStopped} paradas (>3 dias)`);
  for (const p of o.otherPending) out.push(`  pendente vencido em ${p.table}: ${p.count} (decidir antes da virada)`);
  out.push(r.files ? `arquivos: ${r.files.copied} copiados, ${r.files.skipped} já estavam` : `arquivos: não copiados (${r.mode})`);
  return out;
}
```

`api/src/scripts/import-lovable/cli.ts`:

```ts
import { Mode } from './report';

export type CliArgs = { exportDir: string; expectDb: string; uploadsDir: string; mode: Mode; skipCredentials: boolean };

const USAGE = 'uso: --export <pasta> --expect-db <banco> --uploads-dir <pasta> [--dry-run | --verify | --only-files] [--skip-credentials]';
const KNOWN = new Set(['--export', '--expect-db', '--uploads-dir', '--dry-run', '--verify', '--only-files', '--skip-credentials']);
const WITH_VALUE = new Set(['--export', '--expect-db', '--uploads-dir']);

export function parseArgs(argv: string[]): CliArgs {
  const unknown = argv.filter((a, i) => a.startsWith('--') && !KNOWN.has(a) && !WITH_VALUE.has(argv[i - 1] ?? ''));
  if (unknown.length) throw new Error(`opção desconhecida: ${unknown.join(', ')}`);
  const val = (flag: string) => {
    const i = argv.indexOf(flag);
    if (i < 0) return undefined;
    const v = argv[i + 1];
    if (!v || v.startsWith('--')) throw new Error(`${flag} precisa de um valor`);
    return v;
  };
  const exportDir = val('--export');
  const expectDb = val('--expect-db');
  const uploadsDir = val('--uploads-dir');
  if (!exportDir || !expectDb || !uploadsDir) throw new Error(USAGE);
  const modes = (['--dry-run', '--verify', '--only-files'] as const).filter((m) => argv.includes(m));
  if (modes.length > 1) throw new Error(`escolha só um entre ${modes.join(', ')}`);
  const mode: Mode = modes[0] === '--dry-run' ? 'dry-run' : modes[0] === '--verify' ? 'verify' : modes[0] === '--only-files' ? 'only-files' : 'import';
  return { exportDir, expectDb, uploadsDir, mode, skipCredentials: argv.includes('--skip-credentials') };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd api && ../scripts/run-capped.sh 1500 npx jest src/scripts/import-lovable`
Expected: PASS (todas as suítes de `import-lovable`, 31 testes).

- [ ] **Step 5: Commit**

```bash
git add api/src/scripts/import-lovable/{export-reader,copy-files,report,cli}.ts api/src/scripts/import-lovable/__tests__/{export-reader,report-cli}.spec.ts
git commit -m "feat(migracao): leitura conferida da exportação, cópia idempotente dos arquivos, relatório e argumentos do importador

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Importador (carga, contas, links, credenciais, travas, vencidos, dry-run) + e2e

**Files:**
- Create: `api/src/scripts/import-lovable/db.ts`, `importer.ts`, `verify.ts` (esqueleto), `main.ts`, `api/scripts/lovable-export/make-fixture.mjs`, `api/scripts/import-lovable-e2e.sh`

**Interfaces:**
- Consumes: Tasks 1–5 (todas as assinaturas acima); `FilesService.signedUrl(bucket, key): string`, `FilesService.resolvePath`, `BUCKETS`; `VaultService.encryptValue(v: string): string`, `VaultService.decryptValue(v): string | null`; `CredentialStore` (abstrata).
- Produces:
  - `db.ts` (sem depender do importador nem do verify, para não haver import circular): `type Db = Pick<Prisma.TransactionClient, '$queryRawUnsafe' | '$executeRawUnsafe'>`, `type TableInfo = { columns: TargetColumn[]; types: Map<string, string> }`, `type SchemaInfo = Map<string, TableInfo>`, `readSchema(db): Promise<SchemaInfo>`, `assertTarget(db, expectDb, mustBeEmpty): Promise<string>`, `SKIP_TABLES`, `TEXTUAL_TYPES`, `CONNECTION_SECRET_COLUMNS`.
  - `type ImportDeps = { prisma: PrismaClient; files: FileTarget & { signedUrl(b: string, k: string): string }; vault: { encryptValue(v: string): string; decryptValue(v: string | null | undefined): string | null }; legacySecret: string | null; buckets: readonly string[] }`, `type ImportOptions = { exportDir: string; expectDb: string; mode: Mode; skipCredentials: boolean; now: Date }`, `runImport(opts, deps): Promise<{ report: ImportReport; verify?: { ok: boolean; lines: string[] } }>`.
  - `importer.ts`: constantes `LEASE_COLUMNS`, `OVERDUE_POST_MESSAGE`, `CADENCE_STOP_AFTER_MS`, `CADENCE_STOP_REASON`.
  - CLI: `node dist/src/scripts/import-lovable/main.js --export <pasta> --expect-db <banco> --uploads-dir <pasta> [--dry-run|--verify|--only-files] [--skip-credentials]` (ou `npx ts-node --transpile-only src/scripts/import-lovable/main.ts …`). Env: `DATABASE_URL`, `PUBLIC_URL`, `JWT_SECRET`, `FILES_SIGNING_SECRET`, `CREDENTIALS_ENCRYPTION_KEY`, `LEGACY_CREDENTIALS_ENCRYPTION_KEY` (opcional).

- [ ] **Step 1: Escrever a exportação sintética**

`api/scripts/lovable-export/make-fixture.mjs`:

```js
#!/usr/bin/env node
// Exportação SINTÉTICA no formato do pull.mjs (manifest.json + tables/ + storage/), para os testes ponta a ponta
// do importador e do pull. Nada real: ids, e-mails e segredos inventados.
//   node scripts/lovable-export/make-fixture.mjs --out <pasta> --legacy-secret <segredo>
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const OUT = flag('--out');
const SECRET = flag('--legacy-secret');
if (!OUT || !SECRET) { console.error('uso: --out <pasta> --legacy-secret <segredo>'); process.exit(1); }

const WS = '11111111-1111-4111-8111-111111111111';
const U1 = '22222222-2222-4222-8222-222222222221'; // senha (bcrypt)
const U2 = '22222222-2222-4222-8222-222222222222'; // só Google
const U3 = '22222222-2222-4222-8222-222222222223'; // apagada no Lovable
const id = (n) => `55555555-5555-4555-8555-${String(n).padStart(12, '0')}`;
const SB = 'https://abcdefghijklmnop.supabase.co/storage/v1/object';
const H = 3600e3;
const D = 24 * H;
const now = Date.now();
const at = (ms) => new Date(now + ms).toISOString();

/** Igual ao protótipo (`credentials.server.ts`): AES-GCM do WebCrypto, chave = SHA-256 do segredo. */
async function encV1(value, secret) {
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(value)));
  return `enc:v1:${Buffer.from(iv).toString('base64')}:${Buffer.from(ct).toString('base64')}`;
}

const files = {
  [`creative-assets/brands/${WS}/logo.png`]: 'PNG-logo-e2e',
  'creative-assets/2026-09-30/criativo ação.png': 'PNG-criativo-e2e',
  [`ig-media/posts/${WS}/p1.jpg`]: 'JPG-post-e2e',
};

const tables = {
  'auth.users': [
    { id: U1, email: 'Dono@Exemplo.com', encrypted_password: '$2a$10$' + 'a'.repeat(53), created_at: at(-90 * D), deleted_at: null, banned_until: null, is_anonymous: false },
    { id: U2, email: 'google@exemplo.com', encrypted_password: '', created_at: at(-30 * D), deleted_at: null, banned_until: null, is_anonymous: false },
    { id: U3, email: 'apagada@exemplo.com', encrypted_password: '$2a$10$' + 'b'.repeat(53), created_at: at(-60 * D), deleted_at: at(-D), banned_until: null, is_anonymous: false },
  ],
  'auth.identities': [
    { id: id(1), user_id: U2, provider: 'google', provider_id: '109876543210987654321', identity_data: { sub: '109876543210987654321' } },
  ],
  'public.profiles': [
    { id: U1, email: 'dono@exemplo.com', full_name: 'Dono E2E', avatar_url: null, created_at: at(-90 * D) },
    { id: U2, email: 'google@exemplo.com', full_name: 'Google E2E', avatar_url: null, created_at: at(-30 * D) },
    { id: U3, email: 'apagada@exemplo.com', full_name: 'Apagada E2E', avatar_url: null, created_at: at(-60 * D) },
  ],
  'public.workspaces': [{ id: WS, name: 'Empresa E2E', slug: 'empresa-e2e', owner_id: U1, created_at: at(-90 * D) }],
  'public.workspace_members': [{ id: id(2), workspace_id: WS, user_id: U1, role: 'owner', created_at: at(-90 * D) }],
  'public.brands': [
    { id: id(3), workspace_id: WS, name: 'Marca E2E', logo_url: `${SB}/sign/creative-assets/brands/${WS}/logo.png?token=eyJhbGciOi.e2e`, created_at: at(-80 * D), updated_at: '2026-01-02T03:04:05+00:00' },
  ],
  'public.creatives': [
    { id: id(4), workspace_id: WS, title: 'Criativo com galeria', preview_url: `${SB}/sign/creative-assets/2026-09-30/criativo%20a%C3%A7%C3%A3o.png?token=t1`, extras: { gallery: [{ url: `${SB}/public/ig-media/posts/${WS}/p1.jpg` }], nota: 'sem link' } },
    { id: id(5), workspace_id: WS, title: 'Criativo sem arquivo', preview_url: `${SB}/sign/creative-assets/sumiu/arquivo.png?token=t2`, extras: {} },
  ],
  'public.ig_posts': [
    { id: id(6), workspace_id: WS, format: 'feed_image', status: 'scheduled', scheduled_at: at(-2 * D), media: [{ url: `${SB}/sign/ig-media/posts/${WS}/p1.jpg?token=t3`, type: 'image' }], lease_until: at(H) },
    { id: id(7), workspace_id: WS, format: 'feed_image', status: 'scheduled', scheduled_at: at(2 * D), media: [], lease_until: null },
  ],
  'public.publishing_jobs': [
    { id: id(8), workspace_id: WS, channel: 'instagram_organic', target: 'instagram', status: 'queued', run_at: at(-2 * D), ig_post_id: id(6), locked_at: at(-H) },
    { id: id(9), workspace_id: WS, channel: 'instagram_organic', target: 'instagram', status: 'queued', run_at: at(2 * D), ig_post_id: id(7), locked_at: null },
  ],
  'public.crm_leads': [{ id: id(10), workspace_id: WS, name: 'Lead E2E' }],
  'public.crm_cadences': [{ id: id(11), workspace_id: WS, name: 'Cadência E2E' }],
  'public.crm_cadence_runs': [
    { id: id(12), workspace_id: WS, cadence_id: id(11), lead_id: id(10), status: 'running', next_run_at: at(-D), lease_token: 'trava-e2e', lease_until: at(H) },
    { id: id(13), workspace_id: WS, cadence_id: id(11), lead_id: id(10), status: 'running', next_run_at: at(-5 * D), lease_token: null, lease_until: null },
  ],
  'public.app_credentials': [
    { id: id(14), workspace_id: null, key: 'META_APP_SECRET', value: await encV1('segredo-meta-e2e', SECRET), updated_at: at(-D) },
    { id: id(15), workspace_id: WS, key: 'OPENAI_API_KEY', value: 'sk-texto-puro-e2e', updated_at: at(-D) },
    { id: id(16), workspace_id: WS, key: 'RESEND_API_KEY', value: '', updated_at: at(-D) },
  ],
  'public.mcp_connections': [
    { id: id(17), workspace_id: WS, provider: 'canva', server_url: 'https://mcp.canva.com/mcp', access_token: 'token-puro-e2e', status: 'connected' },
  ],
  'public.cron_tokens': [{ name: 'instagram', token: 'token-cron-e2e', created_at: at(-D) }],
};

mkdirSync(join(OUT, 'tables'), { recursive: true });
for (const [k, rows] of Object.entries(tables)) writeFileSync(join(OUT, 'tables', `${k}.json`), JSON.stringify(rows));
const objects = [];
for (const [p, content] of Object.entries(files)) {
  const [bucket, ...rest] = p.split('/');
  const dest = join(OUT, 'storage', p);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, content);
  objects.push({ bucket_id: bucket, name: rest.join('/'), size: Buffer.byteLength(content) });
}
const manifest = {
  counts: Object.fromEntries(Object.entries(tables).map(([k, rows]) => [k, rows.length])),
  buckets: [{ id: 'creative-assets', public: false }, { id: 'ig-media', public: false }],
  objects,
};
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`exportação sintética em ${OUT}: ${Object.keys(tables).length} tabelas, ${objects.length} arquivos`);
```

- [ ] **Step 2: Escrever o e2e (falha: o importador não existe)**

`api/scripts/import-lovable-e2e.sh`:

```bash
#!/usr/bin/env bash
# Ponta a ponta do importador do Lovable num banco LOCAL descartável (meufunil_import_e2e) — nunca em produção.
# Pré: Postgres local de pé (`docker compose up -d postgres` na raiz). Rode capado, de api/:
#   ../scripts/run-capped.sh 1500 bash scripts/import-lovable-e2e.sh
set -euo pipefail
cd "$(dirname "$0")/.."
C=meu-funil-postgres; DB=meufunil_import_e2e
URL="postgresql://meufunil:meufunil@localhost:5439/$DB?schema=public"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
EXP="$TMP/export"; UP="$TMP/uploads"; SECRET=segredo-do-lovable-e2e
WS=11111111-1111-4111-8111-111111111111
OK=0; FAIL=0
check() { if [[ "$2" == "$3" ]]; then OK=$((OK+1)); echo "  ✓ $1"; else FAIL=$((FAIL+1)); echo "  ✗ $1 — esperado [$2], veio [$3]"; fi; }
q() { docker exec -i $C psql -U meufunil -d $DB -Atqc "$1"; }
# imp <saída> <args…>: importador com o ambiente de teste (LEGACY= vazio desliga a chave do Lovable; EXPDIR troca a exportação)
imp() {
  local out="$1"; shift
  DATABASE_URL="$URL" PUBLIC_URL=https://api.e2e.test JWT_SECRET=e2e-jwt-secret-0123456789 FILES_SIGNING_SECRET=e2e-files-secret-0123456789 \
  CREDENTIALS_ENCRYPTION_KEY=e2e-vault-key-0123456789 LEGACY_CREDENTIALS_ENCRYPTION_KEY="${LEGACY-$SECRET}" \
    npx ts-node --transpile-only src/scripts/import-lovable/main.ts --export "${EXPDIR:-$EXP}" --uploads-dir "$UP" "$@" >"$out" 2>&1
}
docker exec $C psql -U meufunil -d postgres -qc "DROP DATABASE IF EXISTS $DB WITH (FORCE)" >/dev/null
docker exec $C psql -U meufunil -d postgres -qc "CREATE DATABASE $DB" >/dev/null
DATABASE_URL="$URL" npx prisma migrate deploy >"$TMP/prisma.log" 2>&1 || { tail -20 "$TMP/prisma.log"; exit 1; }
node scripts/lovable-export/make-fixture.mjs --out "$EXP" --legacy-secret "$SECRET" >/dev/null

echo "== travas"
imp "$TMP/o1" --expect-db outro_banco --dry-run && r=0 || r=$?
check "banco com nome errado é recusado" "1,1" "$r,$(grep -c 'não "outro_banco"' "$TMP/o1")"
LEGACY= imp "$TMP/o2" --expect-db $DB --dry-run && r=0 || r=$?
check "enc:v1 sem a chave do Lovable é recusado" "1,1" "$r,$(grep -c 'LEGACY_CREDENTIALS_ENCRYPTION_KEY' "$TMP/o2")"
cp -r "$EXP" "$TMP/export-ruim"; echo '[]' > "$TMP/export-ruim/tables/public.brands.json"
EXPDIR="$TMP/export-ruim" imp "$TMP/o3" --expect-db $DB --dry-run && r=0 || r=$?
check "exportação inconsistente (linhas ≠ manifesto) é recusada" "1,1" "$r,$(grep -c 'o manifesto diz' "$TMP/o3")"

echo "== dry-run"
imp "$TMP/o4" --expect-db $DB --dry-run && r=0 || { r=$?; cat "$TMP/o4"; }
check "dry-run termina bem e não grava nada" "0,0,0,0" "$r,$(q 'SELECT count(*) FROM users'),$(q 'SELECT count(*) FROM workspaces'),$(find "$UP" -type f 2>/dev/null | wc -l)"
check "dry-run relata contas e links" "1,1" "$(grep -c 'contas: 2 importadas' "$TMP/o4"),$(grep -c 'links do Lovable reescritos: 4;' "$TMP/o4")"

echo "== importação"
imp "$TMP/o5" --expect-db $DB && r=0 || { r=$?; cat "$TMP/o5"; }
check "importação termina bem" "0" "$r"
check "contas: 2 (a apagada fica de fora), e-mail em minúsculas, Google ligado" "2|dono@exemplo.com|109876543210987654321" \
  "$(q 'SELECT count(*) FROM users')|$(q "SELECT email FROM users WHERE id='22222222-2222-4222-8222-222222222221'")|$(q "SELECT google_sub FROM users WHERE id='22222222-2222-4222-8222-222222222222'")"
check "hash bcrypt copiado como está" "t" "$(q "SELECT password_hash LIKE '\$2a\$10\$%' FROM users WHERE id='22222222-2222-4222-8222-222222222221'")"
check "cron_tokens pulada" "0" "$(q 'SELECT count(*) FROM cron_tokens')"
check "logo da marca aponta para a API nova" "1" "$(q "SELECT count(*) FROM brands WHERE logo_url LIKE 'https://api.e2e.test/v1/files/creative-assets/brands/$WS/logo.png?exp=%&sig=%'")"
check "link dentro de JSON (extras.gallery) reescrito" "t" "$(q "SELECT (extras->'gallery'->0->>'url') LIKE 'https://api.e2e.test/v1/files/ig-media/%' FROM creatives WHERE title='Criativo com galeria'")"
check "nome com espaço e acento reescrito" "t" "$(q "SELECT preview_url LIKE 'https://api.e2e.test/v1/files/creative-assets/2026-09-30/criativo%' FROM creatives WHERE title='Criativo com galeria'")"
check "link de arquivo que não veio fica e é listado" "t,1" "$(q "SELECT preview_url LIKE '%supabase.co%' FROM creatives WHERE title='Criativo sem arquivo'"),$(grep -c 'sumiu/arquivo.png' "$TMP/o5")"
check "mídia do post (jsonb) reescrita" "0" "$(q "SELECT count(*) FROM ig_posts WHERE media::text LIKE '%supabase.co%'")"
check "updated_at preservado (gatilhos desligados na carga)" "2026-01-02 03:04:05" "$(q "SELECT to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') FROM brands")"
check "credenciais no formato do nosso cofre (a vazia fica vazia)" "0|1" "$(q "SELECT count(*) FROM app_credentials WHERE value <> '' AND value NOT LIKE 'enc:v2:%'")|$(q "SELECT count(*) FROM app_credentials WHERE value = ''")"
check "token de conexão cifrado" "t" "$(q "SELECT access_token LIKE 'enc:v2:%' FROM mcp_connections")"
check "publicação vencida cancelada e post com falha; futura segue" "cancelled,queued|failed:publish,scheduled" \
  "$(q "SELECT string_agg(status, ',' ORDER BY run_at) FROM publishing_jobs")|$(q "SELECT string_agg(status||coalesce(':'||failure_kind,''), ',' ORDER BY scheduled_at) FROM ig_posts")"
check "cadências: vencida há 1 dia segue; há 5 dias para" "running,stopped" "$(q "SELECT string_agg(status, ',' ORDER BY next_run_at DESC) FROM crm_cadence_runs")"
check "travas zeradas" "0,0" "$(q 'SELECT count(*) FROM ig_posts WHERE lease_until IS NOT NULL'),$(q 'SELECT count(*) FROM crm_cadence_runs WHERE lease_token IS NOT NULL')"
check "arquivos copiados (inclusive com acento)" "3,1" "$(find "$UP" -type f | wc -l),$(test -f "$UP/creative-assets/2026-09-30/criativo ação.png" && echo 1 || echo 0)"

echo "== segunda carga"
imp "$TMP/o6" --expect-db $DB && r=0 || r=$?
check "banco não vazio recusa a segunda carga" "1,1" "$r,$(grep -c 'não está vazio' "$TMP/o6")"

echo; echo "$OK ok, $FAIL falha(s)"
docker exec $C psql -U meufunil -d postgres -qc "DROP DATABASE IF EXISTS $DB WITH (FORCE)" >/dev/null
[[ $FAIL -eq 0 ]]
```

- [ ] **Step 3: Rodar e ver falhar**

Run (raiz): `docker compose up -d postgres`; depois `cd api && ../scripts/run-capped.sh 1500 bash scripts/import-lovable-e2e.sh`
Expected: FAIL — as verificações acusam (o `main.ts` não existe: `Cannot find module`).

- [ ] **Step 4: Implementar o importador**

`api/src/scripts/import-lovable/db.ts`:

```ts
import { Prisma } from '@prisma/client';
import { TargetColumn } from './columns';

export type Db = Pick<Prisma.TransactionClient, '$queryRawUnsafe' | '$executeRawUnsafe'>;
export type TableInfo = { columns: TargetColumn[]; types: Map<string, string> };
export type SchemaInfo = Map<string, TableInfo>;

/** Os agendamentos do Lovable (pg_cron) não podem acionar /api/public/cron/* do sistema novo. */
export const SKIP_TABLES = new Set(['cron_tokens']);
/** Colunas onde pode haver link de arquivo (`data_type`, ou `udt_name` para arrays). */
export const TEXTUAL_TYPES = new Set(['text', 'character varying', 'json', 'jsonb', '_text', '_varchar']);
/** Só o que o nosso código decifra na leitura (`McpService`). */
export const CONNECTION_SECRET_COLUMNS = ['access_token', 'refresh_token', 'oauth_client_secret', 'oauth_code_verifier'];

export async function readSchema(db: Db): Promise<SchemaInfo> {
  const rows = await db.$queryRawUnsafe<
    { table_name: string; column_name: string; is_nullable: string; column_default: string | null; is_generated: string; is_identity: string; data_type: string; udt_name: string }[]
  >(
    `SELECT table_name, column_name, is_nullable, column_default, is_generated, is_identity, data_type, udt_name
       FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`,
  );
  const out: SchemaInfo = new Map();
  for (const r of rows) {
    const t = out.get(r.table_name) ?? { columns: [], types: new Map<string, string>() };
    t.columns.push({ name: r.column_name, nullable: r.is_nullable === 'YES', hasDefault: r.column_default !== null || r.is_identity === 'YES', generated: r.is_generated === 'ALWAYS' });
    t.types.set(r.column_name, r.data_type === 'ARRAY' ? r.udt_name : r.data_type);
    out.set(r.table_name, t);
  }
  return out;
}

/** O banco conectado é o esperado (e, para carregar, está vazio). Devolve o nome. */
export async function assertTarget(db: Db, expectDb: string, mustBeEmpty: boolean): Promise<string> {
  const [row] = await db.$queryRawUnsafe<{ db: string }[]>('SELECT current_database() AS db');
  const name = row?.db ?? '';
  if (name !== expectDb) throw new Error(`O banco conectado é "${name}", não "${expectDb}" (--expect-db). Nada foi gravado.`);
  if (mustBeEmpty) {
    const [c] = await db.$queryRawUnsafe<{ u: number; w: number }[]>('SELECT (SELECT count(*) FROM public.users)::int AS u, (SELECT count(*) FROM public.workspaces)::int AS w');
    if ((c?.u ?? 0) || (c?.w ?? 0)) throw new Error(`O banco "${name}" não está vazio (${c?.u} usuário(s), ${c?.w} empresa(s)). A importação só roda em banco vazio. Nada foi gravado.`);
  }
  return name;
}
```

`api/src/scripts/import-lovable/importer.ts`:

```ts
import { PrismaClient } from '@prisma/client';
import { AuthIdentity, AuthUser, mapUsers } from './auth-map';
import { planColumns, quoteIdent } from './columns';
import { copyExportedFiles, FileTarget } from './copy-files';
import { assertTarget, CONNECTION_SECRET_COLUMNS, Db, readSchema, SchemaInfo, SKIP_TABLES, TEXTUAL_TYPES } from './db';
import { assertObjects, Manifest, readManifest, readTable, tableKeys } from './export-reader';
import { decryptLegacy, isLegacyEncrypted, isOurEncrypted } from './legacy-crypto';
import { emptyReport, ImportReport, Mode } from './report';
import { LinkResolver, rewriteLinks, STORAGE_LIKE } from './storage-links';
import { collectFindings, verdict } from './verify';

export type ImportDeps = {
  prisma: PrismaClient;
  files: FileTarget & { signedUrl(bucket: string, key: string): string };
  vault: { encryptValue(v: string): string; decryptValue(v: string | null | undefined): string | null };
  legacySecret: string | null;
  buckets: readonly string[];
};
export type ImportOptions = { exportDir: string; expectDb: string; mode: Mode; skipCredentials: boolean; now: Date };

export const LEASE_COLUMNS = ['lease_until', 'lease_token', 'locked_until', 'locked_at'];
export const OVERDUE_POST_MESSAGE = 'O horário passou durante a mudança de sistema. Reagende pela tela.';
export const CADENCE_STOP_AFTER_MS = 3 * 86400e3;
export const CADENCE_STOP_REASON = 'Parada na mudança de sistema: o próximo passo venceu há mais de 3 dias.';
const USER_COLUMNS = ['id', 'email', 'password_hash', 'google_sub', 'token_version', 'created_at'];
const PENDING_STATUSES = ['queued', 'pending', 'scheduled', 'running', 'processing'];
const TIME_COLUMNS = ['scheduled_at', 'run_at', 'next_run_at', 'send_at'];

class DryRunRollback extends Error {}

const columnsOf = (schema: SchemaInfo, table: string) => new Set(schema.get(table)?.columns.map((c) => c.name) ?? []);

async function insertRows(db: Db, schema: SchemaInfo, table: string, columns: string[], rows: Record<string, unknown>[]) {
  if (!rows.length || !columns.length) return;
  const t = quoteIdent(table, new Set(schema.keys()));
  const allowed = columnsOf(schema, table);
  const list = columns.map((c) => quoteIdent(c, allowed)).join(', ');
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500).map((r) => Object.fromEntries(columns.map((c) => [c, r[c] ?? null])));
    await db.$executeRawUnsafe(
      `INSERT INTO public.${t} (${list}) OVERRIDING SYSTEM VALUE SELECT ${list} FROM jsonb_populate_recordset(NULL::public.${t}, $1::jsonb)`,
      JSON.stringify(batch),
    );
  }
}

async function loadTables(db: Db, schema: SchemaInfo, dir: string, manifest: Manifest, report: ImportReport): Promise<string[]> {
  const loaded: string[] = [];
  for (const { schema: s, table, count } of tableKeys(manifest)) {
    if (s !== 'public') continue;
    if (SKIP_TABLES.has(table)) {
      report.skippedTables.push(table);
      continue;
    }
    const info = schema.get(table);
    if (!info) throw new Error(`A tabela ${table} da exportação não existe no banco novo. Nada foi gravado.`);
    const rows = readTable(dir, 'public', table);
    if (rows.length !== count) throw new Error(`tables/public.${table}.json tem ${rows.length} linha(s); o manifesto diz ${count}. Refaça o pull.`);
    const plan = planColumns(rows, info.columns);
    if (plan.missingRequired.length) throw new Error(`${table}: coluna(s) obrigatória(s) sem valor na exportação: ${plan.missingRequired.join(', ')}. Nada foi gravado.`);
    await insertRows(db, schema, table, plan.insert, rows);
    report.tables.push({ table, rows: rows.length, sourceOnly: plan.sourceOnly });
    loaded.push(table);
  }
  return loaded;
}

async function rewriteAllLinks(db: Db, schema: SchemaInfo, tables: string[], resolve: LinkResolver, report: ImportReport) {
  const all = new Set(schema.keys());
  for (const table of tables) {
    const t = quoteIdent(table, all);
    const allowed = columnsOf(schema, table);
    for (const [col, type] of schema.get(table)!.types) {
      if (!TEXTUAL_TYPES.has(type)) continue;
      const c = quoteIdent(col, allowed);
      const isArray = type.startsWith('_');
      const rows = await db.$queryRawUnsafe<{ ctid: string; v: unknown }[]>(
        `SELECT ctid::text AS ctid, ${isArray ? `to_jsonb(${c})` : c} AS v FROM public.${t} WHERE ${c}::text LIKE $1`,
        STORAGE_LIKE,
      );
      for (const row of rows) {
        const r = rewriteLinks(row.v, resolve);
        report.links.missing.push(...r.missing);
        if (!r.changed) continue;
        report.links.changed += r.changed;
        const isJson = type === 'json' || type === 'jsonb';
        const value = isJson || isArray ? JSON.stringify(r.value) : (r.value as string);
        const set = isArray
          ? `ARRAY(SELECT jsonb_array_elements_text($1::jsonb))::${type === '_text' ? 'text[]' : 'varchar[]'}`
          : isJson ? `$1::${type}` : '$1';
        await db.$executeRawUnsafe(`UPDATE public.${t} SET ${c} = ${set} WHERE ctid = $2::tid`, value, row.ctid);
      }
    }
  }
}

function decryptOrFail(value: string, secret: string, what: string): string {
  try {
    return decryptLegacy(value, secret);
  } catch {
    throw new Error(`${what} não decifra com a LEGACY_CREDENTIALS_ENCRYPTION_KEY (chave errada?). Nada foi gravado.`);
  }
}

async function migrateCredentials(db: Db, schema: SchemaInfo, deps: ImportDeps, report: ImportReport) {
  const creds = await db.$queryRawUnsafe<{ id: string; value: string }[]>('SELECT id::text AS id, value FROM public.app_credentials');
  for (const c of creds) {
    if (!c.value.trim() || isOurEncrypted(c.value)) continue;
    let plain = c.value;
    if (isLegacyEncrypted(c.value)) {
      if (!deps.legacySecret) {
        await db.$executeRawUnsafe('DELETE FROM public.app_credentials WHERE id = $1::uuid', c.id);
        report.credentials.skippedLegacy++;
        continue;
      }
      plain = decryptOrFail(c.value, deps.legacySecret, `A credencial ${c.id}`);
      report.credentials.reencrypted++;
    } else {
      report.credentials.encryptedPlain++;
    }
    await db.$executeRawUnsafe('UPDATE public.app_credentials SET value = $1 WHERE id = $2::uuid', deps.vault.encryptValue(plain), c.id);
  }
  const allowed = columnsOf(schema, 'mcp_connections');
  for (const col of CONNECTION_SECRET_COLUMNS) {
    if (!allowed.has(col)) continue;
    const c = quoteIdent(col, allowed);
    const rows = await db.$queryRawUnsafe<{ id: string; v: string }[]>(
      `SELECT id::text AS id, ${c} AS v FROM public.mcp_connections WHERE ${c} IS NOT NULL AND btrim(${c}) <> '' AND ${c} NOT LIKE 'enc:v2:%'`,
    );
    for (const r of rows) {
      let plain = r.v;
      if (isLegacyEncrypted(r.v)) {
        if (!deps.legacySecret) {
          await db.$executeRawUnsafe(`UPDATE public.mcp_connections SET ${c} = NULL WHERE id = $1::uuid`, r.id);
          report.credentials.skippedLegacy++;
          continue;
        }
        plain = decryptOrFail(r.v, deps.legacySecret, `O token ${col} da conexão ${r.id}`);
      }
      await db.$executeRawUnsafe(`UPDATE public.mcp_connections SET ${c} = $1 WHERE id = $2::uuid`, deps.vault.encryptValue(plain), r.id);
      report.credentials.connectionsEncrypted++;
    }
  }
}

async function clearLeases(db: Db, schema: SchemaInfo, tables: string[]): Promise<number> {
  let n = 0;
  const all = new Set(schema.keys());
  for (const table of tables) {
    const info = schema.get(table)!;
    const allowed = columnsOf(schema, table);
    for (const col of LEASE_COLUMNS) {
      const meta = info.columns.find((x) => x.name === col);
      if (!meta || !meta.nullable) continue;
      const c = quoteIdent(col, allowed);
      n += await db.$executeRawUnsafe(`UPDATE public.${quoteIdent(table, all)} SET ${c} = NULL WHERE ${c} IS NOT NULL`);
    }
  }
  return n;
}

async function applyOverdue(db: Db, schema: SchemaInfo, tables: string[], now: Date, report: ImportReport) {
  const nowIso = now.toISOString();
  const jobs = await db.$queryRawUnsafe<{ ig_post_id: string | null }[]>(
    `UPDATE public.publishing_jobs SET status = 'cancelled', locked_at = NULL, log = $1
      WHERE status IN ('queued','processing') AND run_at < $2::timestamptz RETURNING ig_post_id::text AS ig_post_id`,
    OVERDUE_POST_MESSAGE,
    nowIso,
  );
  report.overdue.jobsCancelled = jobs.length;
  const ids = [...new Set(jobs.map((j) => j.ig_post_id).filter((x): x is string => !!x))];
  report.overdue.postsFailed = ids.length
    ? await db.$executeRawUnsafe(
        `UPDATE public.ig_posts SET status = 'failed', failure_kind = 'publish', last_error = $1
          WHERE id = ANY($2::uuid[]) AND status IN ('scheduled','publishing','approved','ready')`,
        OVERDUE_POST_MESSAGE,
        ids,
      )
    : 0;
  report.overdue.cadencesStopped = await db.$executeRawUnsafe(
    `UPDATE public.crm_cadence_runs SET status = 'stopped', stop_reason = $1 WHERE status = 'running' AND next_run_at < $2::timestamptz`,
    CADENCE_STOP_REASON,
    new Date(now.getTime() - CADENCE_STOP_AFTER_MS).toISOString(),
  );
  const [kept] = await db.$queryRawUnsafe<{ n: number }[]>(
    `SELECT count(*)::int AS n FROM public.crm_cadence_runs WHERE status = 'running' AND next_run_at < $1::timestamptz`,
    nowIso,
  );
  report.overdue.cadencesKept = kept?.n ?? 0;
  const all = new Set(schema.keys());
  for (const table of tables) {
    if (table === 'publishing_jobs' || table === 'crm_cadence_runs') continue;
    const allowed = columnsOf(schema, table);
    if (!allowed.has('status')) continue;
    for (const col of TIME_COLUMNS) {
      if (!allowed.has(col)) continue;
      const [row] = await db.$queryRawUnsafe<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM public.${quoteIdent(table, all)} WHERE status::text = ANY($1::text[]) AND ${quoteIdent(col, allowed)} < $2::timestamptz`,
        PENDING_STATUSES,
        nowIso,
      );
      if (row?.n) report.overdue.otherPending.push({ table: `${table}.${col}`, count: row.n });
    }
  }
}

function legacyCount(dir: string): number {
  const values = [
    ...readTable(dir, 'public', 'app_credentials').map((r) => r['value']),
    ...readTable(dir, 'public', 'mcp_connections').flatMap((r) => CONNECTION_SECRET_COLUMNS.map((c) => r[c])),
  ];
  return values.filter((v) => typeof v === 'string' && isLegacyEncrypted(v)).length;
}

export async function runImport(opts: ImportOptions, deps: ImportDeps): Promise<{ report: ImportReport; verify?: { ok: boolean; lines: string[] } }> {
  const db: Db = deps.prisma;
  const manifest = readManifest(opts.exportDir);
  const usersPlan = () =>
    mapUsers(readTable(opts.exportDir, 'auth', 'users') as AuthUser[], readTable(opts.exportDir, 'auth', 'identities') as AuthIdentity[], opts.now);

  if (opts.mode === 'verify') {
    const database = await assertTarget(db, opts.expectDb, false);
    const schema = await readSchema(db);
    const findings = await collectFindings(db, {
      schema,
      manifest,
      expectedUsers: usersPlan().users.length,
      exportDir: opts.exportDir,
      files: deps.files,
      decrypt: (v) => deps.vault.decryptValue(v),
    });
    return { report: emptyReport('verify', database), verify: verdict(findings) };
  }

  if (opts.mode === 'only-files') {
    const database = await assertTarget(db, opts.expectDb, false);
    assertObjects(opts.exportDir, manifest, deps.buckets);
    const report = emptyReport('only-files', database);
    report.files = await copyExportedFiles(opts.exportDir, manifest, deps.files);
    return { report };
  }

  const database = await assertTarget(db, opts.expectDb, true);
  assertObjects(opts.exportDir, manifest, deps.buckets);
  for (const o of manifest.objects) deps.files.resolvePath(o.bucket_id, o.name); // chave inválida aborta antes de gravar
  const plan = usersPlan(); // e-mail repetido aborta aqui
  const legacy = legacyCount(opts.exportDir);
  if (legacy && !deps.legacySecret && !opts.skipCredentials) {
    throw new Error(`Há ${legacy} credencial(is) cifrada(s) pelo Lovable (enc:v1). Defina LEGACY_CREDENTIALS_ENCRYPTION_KEY no .env ou rode com --skip-credentials. Nada foi gravado.`);
  }
  const schema = await readSchema(db);
  const report = emptyReport(opts.mode, database);
  report.users = { imported: plan.users.length, skipped: plan.skipped, noLogin: plan.noLogin, nonBcrypt: plan.nonBcrypt };
  const exported = new Set(manifest.objects.map((o) => `${o.bucket_id}/${o.name}`));
  const resolve: LinkResolver = (bucket, key) => (exported.has(`${bucket}/${key}`) ? deps.files.signedUrl(bucket, key) : null);

  try {
    await deps.prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
        const loaded = await loadTables(tx, schema, opts.exportDir, manifest, report);
        await insertRows(tx, schema, 'users', USER_COLUMNS, plan.users as unknown as Record<string, unknown>[]);
        await rewriteAllLinks(tx, schema, loaded, resolve, report);
        await migrateCredentials(tx, schema, deps, report);
        report.leasesCleared = await clearLeases(tx, schema, loaded);
        await applyOverdue(tx, schema, loaded, opts.now, report);
        if (opts.mode === 'dry-run') throw new DryRunRollback();
      },
      { timeout: 60 * 60e3, maxWait: 60e3 },
    );
  } catch (e) {
    if (!(e instanceof DryRunRollback)) throw e;
  }
  if (opts.mode === 'import') report.files = await copyExportedFiles(opts.exportDir, manifest, deps.files);
  return { report };
}
```

Nesta tarefa o `verify.ts` ainda não existe: crie-o com o esqueleto abaixo (a Task 7 completa e testa), para o importador compilar.

`api/src/scripts/import-lovable/verify.ts` (esqueleto desta tarefa):

```ts
import type { FileTarget } from './copy-files';
import type { Db, SchemaInfo } from './db';
import type { Manifest } from './export-reader';

export type VerifyFindings = {
  countMismatches: { table: string; expected: number; actual: number }[];
  orphans: { table: string; column: string; count: number }[];
  missingFiles: string[];
  remainingLinks: { table: string; column: string; count: number }[];
  unreadableCredentials: number;
};
export type VerifyContext = { schema: SchemaInfo; manifest: Manifest; expectedUsers: number; exportDir: string; files: FileTarget; decrypt: (v: string) => string | null };

export async function collectFindings(_db: Db, _ctx: VerifyContext): Promise<VerifyFindings> {
  throw new Error('--verify ainda não implementado');
}

export function verdict(_f: VerifyFindings): { ok: boolean; lines: string[] } {
  throw new Error('--verify ainda não implementado');
}
```

`api/src/scripts/import-lovable/main.ts`:

```ts
import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';
import { BUCKETS, FilesService } from '../../modules/files/files.service';
import { CredentialStore } from '../../modules/vault/credential-store';
import { VaultService } from '../../modules/vault/vault.service';
import { parseArgs } from './cli';
import { runImport } from './importer';
import { formatReport } from './report';

/** O importador só cifra/decifra valores; o cofre nunca lê nem grava por aqui. */
class NoStore extends CredentialStore {
  async read() {
    return null;
  }
  async upsert() {}
  async delete() {}
  async list() {
    return [];
  }
}

/**
 * Importador dos dados do Lovable (script avulso: NÃO sobe o app Nest, então o agendador não roda durante a carga).
 * Ver docs/migracao-lovable.md. Uso: node dist/src/scripts/import-lovable/main.js --export <pasta> --expect-db <banco> --uploads-dir <pasta> [--dry-run|--verify|--only-files] [--skip-credentials]
 */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = process.env;
  for (const k of ['DATABASE_URL', 'PUBLIC_URL', 'JWT_SECRET', 'CREDENTIALS_ENCRYPTION_KEY'] as const) {
    if (!env[k]) throw new Error(`falta a variável de ambiente ${k}`);
  }
  const prisma = new PrismaClient({ datasourceUrl: env.DATABASE_URL });
  const files = new FilesService({ UPLOADS_DIR: args.uploadsDir, FILES_SIGNING_SECRET: env.FILES_SIGNING_SECRET, JWT_SECRET: env.JWT_SECRET!, PUBLIC_URL: env.PUBLIC_URL! });
  const vault = new VaultService(new NoStore(), { CREDENTIALS_ENCRYPTION_KEY: env.CREDENTIALS_ENCRYPTION_KEY, NODE_ENV: 'production' });
  try {
    const { report, verify } = await runImport(
      { exportDir: args.exportDir, expectDb: args.expectDb, mode: args.mode, skipCredentials: args.skipCredentials, now: new Date() },
      { prisma, files, vault, legacySecret: env.LEGACY_CREDENTIALS_ENCRYPTION_KEY || null, buckets: BUCKETS },
    );
    for (const line of verify ? verify.lines : formatReport(report)) console.log(line);
    console.log(`RELATORIO_JSON ${JSON.stringify(report)}`);
    if (verify && !verify.ok) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e: unknown) => {
  console.error(`ERRO: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
```

- [ ] **Step 5: Rodar o e2e e ver passar**

Run: `cd api && ../scripts/run-capped.sh 1500 bash scripts/import-lovable-e2e.sh`
Expected: PASS — `22 ok, 0 falha(s)` (travas 3, dry-run 2, importação 16, segunda carga 1). Se uma verificação falhar, depure a causa (systematic-debugging) — não ajuste o esperado.

- [ ] **Step 6: Typecheck e jest da pasta**

Run: `cd api && ../scripts/run-capped.sh 1500 npm run typecheck` (sozinho) e depois `../scripts/run-capped.sh 1500 npx jest src/scripts/import-lovable`
Expected: typecheck 0 erros; jest PASS.

- [ ] **Step 7: Commit**

```bash
git add api/src/scripts/import-lovable/{db,importer,verify,main}.ts api/scripts/lovable-export/make-fixture.mjs api/scripts/import-lovable-e2e.sh
git commit -m "feat(migracao): importador do Lovable — carga numa transação, contas, links reescritos, credenciais recifradas, travas e vencidos, dry-run (e2e local)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `--verify`

**Files:**
- Modify: `api/src/scripts/import-lovable/verify.ts` (substitui o esqueleto)
- Modify: `api/scripts/import-lovable-e2e.sh` (bloco antes do resumo)
- Test: `api/src/scripts/import-lovable/__tests__/verify.spec.ts`

**Interfaces:**
- Consumes: `Db`, `SchemaInfo`, `SKIP_TABLES`, `TEXTUAL_TYPES`, `CONNECTION_SECRET_COLUMNS` de `db.ts` (Task 6); `quoteIdent` (Task 2); `STORAGE_LIKE` (Task 4); `Manifest`, `tableKeys`, `exportedFilePath` (Task 5); `FileTarget` (Task 5).
- Produces: `collectFindings(db, ctx: VerifyContext): Promise<VerifyFindings>`, `verdict(f): { ok: boolean; lines: string[] }` — linhas incluem `verificação: ok` ou `verificação: PENDÊNCIAS`, `credenciais ilegíveis: <n>`, e o caminho de cada arquivo ausente.

- [ ] **Step 1: Escrever o teste da decisão (falha)**

`api/src/scripts/import-lovable/__tests__/verify.spec.ts`:

```ts
import { verdict, VerifyFindings } from '../verify';

const clean = (): VerifyFindings => ({ countMismatches: [], orphans: [], missingFiles: [], remainingLinks: [], unreadableCredentials: 0 });

describe('verdict', () => {
  it('tudo limpo: ok', () => {
    expect(verdict(clean())).toEqual({ ok: true, lines: ['verificação: ok'] });
  });

  it('links do Lovable restantes só avisam', () => {
    const f = clean();
    f.remainingLinks.push({ table: 'creatives', column: 'preview_url', count: 1 });
    const v = verdict(f);
    expect(v.ok).toBe(true);
    expect(v.lines).toContain('aviso: links do Lovable restantes em creatives.preview_url: 1');
  });

  it('contagem menor, órfão, arquivo ausente ou credencial ilegível reprovam', () => {
    const f = clean();
    f.countMismatches.push({ table: 'brands', expected: 3, actual: 2 });
    f.orphans.push({ table: 'crm_leads', column: 'owner_id', count: 4 });
    f.missingFiles.push('ig-media/posts/w1/p1.jpg');
    f.unreadableCredentials = 2;
    const v = verdict(f);
    expect(v.ok).toBe(false);
    expect(v.lines).toEqual([
      'contagem menor que o manifesto em brands: 2 de 3',
      'linhas órfãs em crm_leads.owner_id: 4',
      'arquivos ausentes: 1 — ig-media/posts/w1/p1.jpg',
      'credenciais ilegíveis: 2',
      'verificação: PENDÊNCIAS',
    ]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd api && ../scripts/run-capped.sh 1500 npx jest src/scripts/import-lovable/__tests__/verify.spec.ts`
Expected: FAIL — `--verify ainda não implementado`.

- [ ] **Step 3: Acrescentar ao e2e as verificações do `--verify` e do `--only-files`**

Em `api/scripts/import-lovable-e2e.sh`, antes da linha `echo; echo "$OK ok, $FAIL falha(s)"`:

```bash
echo "== verificação e só-arquivos"
imp "$TMP/o7" --expect-db $DB --verify && r=0 || { r=$?; cat "$TMP/o7"; }
check "verificação limpa (o link do arquivo que não veio só avisa)" "0,1,1" "$r,$(grep -c 'verificação: ok' "$TMP/o7"),$(grep -c 'aviso: links do Lovable restantes em creatives.preview_url: 1' "$TMP/o7")"
rm -f "$UP/ig-media/posts/$WS/p1.jpg"
imp "$TMP/o8" --expect-db $DB --verify && r=0 || r=$?
check "verificação acusa arquivo ausente" "1,1" "$r,$(grep -c "ig-media/posts/$WS/p1.jpg" "$TMP/o8")"
imp "$TMP/o9" --expect-db $DB --only-files && r=0 || r=$?
check "--only-files repõe só o que falta" "0,1" "$r,$(grep -c 'arquivos: 1 copiados, 2 já estavam' "$TMP/o9")"
q "UPDATE app_credentials SET value = 'enc:v2:AAAA:BBBB:CCCC' WHERE key = 'OPENAI_API_KEY'" >/dev/null
imp "$TMP/o10" --expect-db $DB --verify && r=0 || r=$?
check "verificação acusa credencial ilegível" "1,1" "$r,$(grep -c 'credenciais ilegíveis: 1' "$TMP/o10")"
```

- [ ] **Step 4: Implementar o `verify.ts`**

`api/src/scripts/import-lovable/verify.ts` (conteúdo final):

```ts
import { stat } from 'node:fs/promises';
import { quoteIdent } from './columns';
import type { FileTarget } from './copy-files';
import { CONNECTION_SECRET_COLUMNS, Db, SchemaInfo, SKIP_TABLES, TEXTUAL_TYPES } from './db';
import { exportedFilePath, Manifest, tableKeys } from './export-reader';
import { STORAGE_LIKE } from './storage-links';

export type VerifyFindings = {
  countMismatches: { table: string; expected: number; actual: number }[];
  orphans: { table: string; column: string; count: number }[];
  missingFiles: string[];
  remainingLinks: { table: string; column: string; count: number }[];
  unreadableCredentials: number;
};
export type VerifyContext = { schema: SchemaInfo; manifest: Manifest; expectedUsers: number; exportDir: string; files: FileTarget; decrypt: (v: string) => string | null };

/** Coluna → tabela-mãe usada para achar linhas órfãs (conta ou empresa que não veio). */
const PARENTS: Record<string, string> = { workspace_id: 'workspaces', user_id: 'users', owner_id: 'users', created_by: 'users' };

export async function collectFindings(db: Db, ctx: VerifyContext): Promise<VerifyFindings> {
  const f: VerifyFindings = { countMismatches: [], orphans: [], missingFiles: [], remainingLinks: [], unreadableCredentials: 0 };
  const all = new Set(ctx.schema.keys());
  const scalar = async (sql: string, ...args: unknown[]) => (await db.$queryRawUnsafe<{ n: number }[]>(sql, ...args))[0]?.n ?? 0;

  // 1) Contagens: o destino tem ao menos o que o manifesto diz (a API pode ter criado linhas depois da carga).
  for (const { schema, table, count } of tableKeys(ctx.manifest)) {
    if (schema !== 'public' || SKIP_TABLES.has(table) || !all.has(table)) continue;
    const actual = await scalar(`SELECT count(*)::int AS n FROM public.${quoteIdent(table, all)}`);
    if (actual < count) f.countMismatches.push({ table, expected: count, actual });
  }
  const users = await scalar('SELECT count(*)::int AS n FROM public.users');
  if (users < ctx.expectedUsers) f.countMismatches.push({ table: 'users', expected: ctx.expectedUsers, actual: users });

  // 2) Órfãos e 3) links restantes, coluna a coluna.
  for (const [table, info] of ctx.schema) {
    const t = quoteIdent(table, all);
    const allowed = new Set(info.types.keys());
    for (const [col, parent] of Object.entries(PARENTS)) {
      if (table === 'users' || info.types.get(col) !== 'uuid') continue;
      const c = quoteIdent(col, allowed);
      const n = await scalar(`SELECT count(*)::int AS n FROM public.${t} x WHERE x.${c} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.${parent} p WHERE p.id = x.${c})`);
      if (n) f.orphans.push({ table, column: col, count: n });
    }
    for (const [col, type] of info.types) {
      if (!TEXTUAL_TYPES.has(type)) continue;
      const c = quoteIdent(col, allowed);
      const n = await scalar(`SELECT count(*)::int AS n FROM public.${t} WHERE ${c}::text LIKE $1`, STORAGE_LIKE);
      if (n) f.remainingLinks.push({ table, column: col, count: n });
    }
  }

  // 4) Arquivos: cada objeto exportado está no UPLOADS_DIR com o mesmo tamanho.
  for (const o of ctx.manifest.objects) {
    const [src, dest] = await Promise.all([stat(exportedFilePath(ctx.exportDir, o.bucket_id, o.name)), stat(ctx.files.resolvePath(o.bucket_id, o.name)).catch(() => null)]);
    if (!dest || dest.size !== src.size) f.missingFiles.push(`${o.bucket_id}/${o.name}`);
  }

  // 5) Credenciais: toda não vazia decifra com a chave atual.
  const values = await db.$queryRawUnsafe<{ v: string | null }[]>(
    `SELECT value AS v FROM public.app_credentials UNION ALL ${CONNECTION_SECRET_COLUMNS.map((c) => `SELECT ${quoteIdent(c, new Set(CONNECTION_SECRET_COLUMNS))} AS v FROM public.mcp_connections`).join(' UNION ALL ')}`,
  );
  f.unreadableCredentials = values.filter((r) => r.v && r.v.trim() && ctx.decrypt(r.v) === null).length;
  return f;
}

export function verdict(f: VerifyFindings): { ok: boolean; lines: string[] } {
  const lines: string[] = [];
  for (const m of f.countMismatches) lines.push(`contagem menor que o manifesto em ${m.table}: ${m.actual} de ${m.expected}`);
  for (const o of f.orphans) lines.push(`linhas órfãs em ${o.table}.${o.column}: ${o.count}`);
  if (f.missingFiles.length) lines.push(`arquivos ausentes: ${f.missingFiles.length} — ${f.missingFiles.slice(0, 20).join(', ')}`);
  if (f.unreadableCredentials) lines.push(`credenciais ilegíveis: ${f.unreadableCredentials}`);
  const ok = !f.countMismatches.length && !f.orphans.length && !f.missingFiles.length && !f.unreadableCredentials;
  for (const l of f.remainingLinks) lines.push(`aviso: links do Lovable restantes em ${l.table}.${l.column}: ${l.count}`);
  lines.push(ok ? 'verificação: ok' : 'verificação: PENDÊNCIAS');
  return { ok, lines };
}
```

- [ ] **Step 5: Rodar o unit e o e2e**

Run: `cd api && ../scripts/run-capped.sh 1500 npx jest src/scripts/import-lovable/__tests__/verify.spec.ts` e depois `../scripts/run-capped.sh 1500 bash scripts/import-lovable-e2e.sh`
Expected: jest PASS (3 testes); e2e `26 ok, 0 falha(s)`.

- [ ] **Step 6: Commit**

```bash
git add api/src/scripts/import-lovable/verify.ts api/src/scripts/import-lovable/__tests__/verify.spec.ts api/scripts/import-lovable-e2e.sh
git commit -m "feat(migracao): --verify do importador (contagens, órfãos, arquivos, credenciais; links restantes só avisam)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Lado da exportação — SQL, pull, prompts e Lovable falso

**Files:**
- Create: `api/scripts/lovable-export/export_meufunil.sql`, `pull.mjs`, `fake-lovable.mjs`, `render-prompts.mjs`, `prompt-exportacao.md`, `prompt-limpeza.md`, `pull-e2e.sh`

**Interfaces:**
- Consumes: `make-fixture.mjs` (Task 6).
- Produces: `node scripts/lovable-export/pull.mjs --env <arquivo SUPABASE_URL/SUPABASE_PUBLISHABLE_KEY> --token-file <arquivo> --out <pasta> --file-url <https://…/api/export-file> [--check-only]`; `node scripts/lovable-export/render-prompts.mjs --hash <sha256> [--only exportacao|limpeza]`; RPC `public.export_meufunil(p_token, p_action, p_schema, p_table, p_limit, p_offset)`.

- [ ] **Step 1: Escrever o teste (falha)**

`api/scripts/lovable-export/pull-e2e.sh`:

```bash
#!/usr/bin/env bash
# Teste do pull.mjs contra um Lovable falso (fake-lovable.mjs) servindo uma exportação sintética, e dos prompts. Sem rede externa.
#   (de api/) bash scripts/lovable-export/pull-e2e.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
TMP="$(mktemp -d)"; PID=""; trap '[[ -n "$PID" ]] && kill "$PID" 2>/dev/null; rm -rf "$TMP"' EXIT
OK=0; FAIL=0
check() { if [[ "$2" == "$3" ]]; then OK=$((OK+1)); echo "  ✓ $1"; else FAIL=$((FAIL+1)); echo "  ✗ $1 — esperado [$2], veio [$3]"; fi; }
node scripts/lovable-export/make-fixture.mjs --out "$TMP/origem" --legacy-secret x >/dev/null
printf 'token-e2e-123' > "$TMP/token"
node scripts/lovable-export/fake-lovable.mjs --dir "$TMP/origem" --token token-e2e-123 --port-file "$TMP/porta" >"$TMP/fake.log" 2>&1 & PID=$!
for _ in $(seq 1 50); do [[ -s "$TMP/porta" ]] && break; sleep 0.1; done
P=$(cat "$TMP/porta")
printf 'SUPABASE_URL="http://127.0.0.1:%s"\nSUPABASE_PUBLISHABLE_KEY="anon-e2e"\n' "$P" > "$TMP/env"
pull() { node scripts/lovable-export/pull.mjs --env "$TMP/env" --token-file "$TMP/token" --file-url "http://127.0.0.1:$P/api/export-file" "$@"; }

pull --out "$TMP/so-conta" --check-only >"$TMP/o1" 2>&1 && r=0 || r=$?
check "--check-only mostra o total e não baixa nada" "0,1,0" "$r,$(grep -c 'arquivos: 3 (creative-assets: 2, ig-media: 1)' "$TMP/o1"),$(find "$TMP/so-conta" -path '*/storage/*' -type f 2>/dev/null | wc -l)"
pull --out "$TMP/destino" >"$TMP/o2" 2>&1 && r=0 || { r=$?; cat "$TMP/o2"; }
check "pull completo e conferido" "0,1" "$r,$(grep -c 'exportação completa e conferida' "$TMP/o2")"
check "arquivos idênticos à origem" "0" "$(diff -r "$TMP/origem/storage" "$TMP/destino/storage" >/dev/null && echo 0 || echo 1)"
iguais=0; for f in "$TMP"/origem/tables/*.json; do cmp -s "$f" "$TMP/destino/tables/$(basename "$f")" && iguais=$((iguais+1)); done
check "tabelas idênticas à origem" "$(ls "$TMP"/origem/tables | wc -l)" "$iguais"
check "pasta da exportação só do dono" "700" "$(stat -c %a "$TMP/destino")"
printf 'token-errado' > "$TMP/token"
pull --out "$TMP/negado" >"$TMP/o3" 2>&1 && r=0 || r=$?
check "token errado: recusado" "1" "$r"

H=$(printf 'a%.0s' $(seq 1 64))
node scripts/lovable-export/render-prompts.mjs --hash "$H" --only exportacao >"$TMP/p1"
check "prompt de exportação: SQL inteiro, hash no SQL e na rota, sem marcador" "1,1,2,0" \
  "$(grep -c 'CREATE OR REPLACE FUNCTION public.export_meufunil' "$TMP/p1"),$(grep -c '^AS \$\$$' "$TMP/p1"),$(grep -c "$H" "$TMP/p1"),$(grep -c '__' "$TMP/p1")"
node scripts/lovable-export/render-prompts.mjs --hash curto >/dev/null 2>&1 && r=0 || r=$?
check "hash inválido recusado" "1" "$r"

echo; echo "$OK ok, $FAIL falha(s)"; [[ $FAIL -eq 0 ]]
```

Run: `cd api && bash scripts/lovable-export/pull-e2e.sh`
Expected: FAIL — `fake-lovable.mjs`/`pull.mjs` não existem.

- [ ] **Step 2: SQL da função (molde do gestao, com marcador do hash)**

`api/scripts/lovable-export/export_meufunil.sql`:

```sql
-- Função TEMPORÁRIA de exportação (migração do Meu Funil para a stack própria).
-- SÓ LEITURA. Só responde a quem manda o token cujo SHA-256 está abaixo.
-- Apagar depois da virada: DROP FUNCTION public.export_meufunil(text, text, text, text, integer, integer);
CREATE OR REPLACE FUNCTION public.export_meufunil(
  p_token text,
  p_action text,
  p_schema text DEFAULT NULL,
  p_table text DEFAULT NULL,
  p_limit integer DEFAULT 500,
  p_offset integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_counts jsonb := '{}'::jsonb;
  v_rows jsonb;
  v_n bigint;
  t text;
BEGIN
  IF p_token IS NULL OR encode(sha256(convert_to(p_token, 'UTF8')), 'hex') <> '__TOKEN_SHA256__' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_action = 'manifest' THEN
    FOR t IN SELECT table_name FROM information_schema.tables
             WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1 LOOP
      EXECUTE format('SELECT count(*) FROM public.%I', t) INTO v_n;
      v_counts := v_counts || jsonb_build_object('public.' || t, v_n);
    END LOOP;
    SELECT count(*) INTO v_n FROM auth.users;
    v_counts := v_counts || jsonb_build_object('auth.users', v_n);
    SELECT count(*) INTO v_n FROM auth.identities;
    v_counts := v_counts || jsonb_build_object('auth.identities', v_n);
    RETURN jsonb_build_object(
      'counts', v_counts,
      'buckets', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'public', public) ORDER BY id), '[]'::jsonb) FROM storage.buckets),
      'objects', (SELECT coalesce(jsonb_agg(jsonb_build_object('bucket_id', bucket_id, 'name', name, 'size', (metadata->>'size')::bigint) ORDER BY bucket_id, name), '[]'::jsonb) FROM storage.objects)
    );
  END IF;

  IF p_action = 'table' THEN
    IF NOT (
      (p_schema = 'public' AND EXISTS (SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name = p_table))
      OR (p_schema = 'auth' AND p_table IN ('users', 'identities'))
    ) THEN
      RAISE EXCEPTION 'tabela não permitida: %.%', p_schema, p_table;
    END IF;
    EXECUTE format(
      'SELECT coalesce(jsonb_agg(r), ''[]''::jsonb) FROM (SELECT to_jsonb(x) AS r FROM %I.%I x ORDER BY x::text LIMIT %s OFFSET %s) s',
      p_schema, p_table, least(greatest(p_limit, 1), 2000), greatest(p_offset, 0)
    ) INTO v_rows;
    RETURN jsonb_build_object('rows', v_rows);
  END IF;

  RAISE EXCEPTION 'ação inválida (manifest | table)';
END;
$$;

REVOKE ALL ON FUNCTION public.export_meufunil(text, text, text, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.export_meufunil(text, text, text, text, integer, integer) TO anon, authenticated;
```

- [ ] **Step 3: Prompts**

`api/scripts/lovable-export/prompt-exportacao.md`:

```
Vamos preparar a exportação dos dados do sistema, em duas partes. Não mexa em telas, tabelas, dados nem políticas existentes.

PARTE 1 — Migration do banco
Crie uma migration com EXATAMENTE o SQL abaixo, sem alterar nada, e aplique. Ela cria uma função temporária e só de leitura (STABLE), protegida por token: sem o token certo ela só devolve erro. Vamos apagá-la depois da migração do sistema.

__SQL__

PARTE 2 — Endereço temporário só para ARQUIVOS
Crie no app um endereço de servidor temporário:
  GET /api/export-file?bucket=<bucket>&name=<caminho do arquivo>
Regras:
- Exige o header "x-export-token". Calcule o SHA-256 (hex) do valor recebido; se for diferente de
  __TOKEN_SHA256__, responda 403 e nada mais.
- Só aceite os buckets "creative-assets" e "ig-media"; outro bucket → 403.
- Com token certo: baixe o arquivo do Storage (bucket e caminho recebidos) no servidor, com a service role
  (src/integrations/supabase/client.server.ts), e devolva os bytes crus com status 200 e content-type application/octet-stream. Se não existir, 404.
- Não liste arquivos, não aceite outros métodos, não exponha a service role, não registre o token em log.
- Publique o app depois de criar o endereço.
```

`api/scripts/lovable-export/prompt-limpeza.md`:

```
A migração do sistema terminou. Remova a exportação temporária e os agendamentos, sem mexer em mais nada:

1. Crie e aplique uma migration com exatamente:
   DROP FUNCTION IF EXISTS public.export_meufunil(text, text, text, text, integer, integer);
   SELECT cron.unschedule(jobid) FROM cron.job WHERE command LIKE '%/api/public/cron/%';
2. Apague o endereço de servidor /api/export-file (o arquivo da rota) e publique o app.
```

`api/scripts/lovable-export/render-prompts.mjs`:

```js
#!/usr/bin/env node
// Monta os prompts do Lovable com o SQL da exportação e o HASH do token (o token em si nunca entra no prompt).
//   node scripts/lovable-export/render-prompts.mjs --hash <sha256 hex> [--only exportacao|limpeza]
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const HASH = flag('--hash') ?? '';
if (!/^[0-9a-f]{64}$/.test(HASH)) { console.error('--hash precisa ser o SHA-256 (64 hex) do token'); process.exit(1); }
const only = flag('--only');
// Substituição por função: o SQL tem `$$`, que num texto de substituição viraria `$`.
const sql = readFileSync(join(AQUI, 'export_meufunil.sql'), 'utf8').replaceAll('__TOKEN_SHA256__', () => HASH);
const exportacao = readFileSync(join(AQUI, 'prompt-exportacao.md'), 'utf8').replace('__SQL__', () => sql.trimEnd()).replaceAll('__TOKEN_SHA256__', () => HASH);
const limpeza = readFileSync(join(AQUI, 'prompt-limpeza.md'), 'utf8');
if (only !== 'limpeza') console.log(exportacao);
if (only !== 'exportacao') console.log(limpeza);
```

- [ ] **Step 4: Lovable falso e pull**

`api/scripts/lovable-export/fake-lovable.mjs`:

```js
#!/usr/bin/env node
// Imita o Lovable na exportação, só para o teste do pull: POST /rest/v1/rpc/export_meufunil (manifest | table)
// e GET /api/export-file, servindo uma exportação sintética (make-fixture.mjs).
//   node scripts/lovable-export/fake-lovable.mjs --dir <export> --token <token> --port-file <arquivo>
import { createServer } from 'node:http';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const DIR = flag('--dir'); const TOKEN = flag('--token'); const PORT_FILE = flag('--port-file');
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'POST' && url.pathname === '/rest/v1/rpc/export_meufunil') {
    if (!req.headers.apikey) return json(res, 401, { message: 'sem apikey' });
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const b = JSON.parse(raw || '{}');
      if (b.p_token !== TOKEN) return json(res, 400, { message: 'forbidden' });
      if (b.p_action === 'manifest') return json(res, 200, JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8')));
      if (b.p_action === 'table') {
        const file = join(DIR, 'tables', `${b.p_schema}.${b.p_table}.json`);
        if (!existsSync(file)) return json(res, 400, { message: 'tabela não permitida' });
        const rows = JSON.parse(readFileSync(file, 'utf8'));
        return json(res, 200, { rows: rows.slice(b.p_offset, b.p_offset + Math.min(b.p_limit, 2000)) });
      }
      return json(res, 400, { message: 'ação inválida' });
    });
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/export-file') {
    if (req.headers['x-export-token'] !== TOKEN) { res.writeHead(403); return res.end(); }
    const bucket = url.searchParams.get('bucket'); const name = url.searchParams.get('name');
    const file = join(DIR, 'storage', bucket, name);
    if (!existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': 'application/octet-stream' });
    return res.end(readFileSync(file));
  }
  res.writeHead(404); res.end();
});
server.listen(0, '127.0.0.1', () => writeFileSync(PORT_FILE, String(server.address().port)));
```

`api/scripts/lovable-export/pull.mjs`:

```js
#!/usr/bin/env node
// Puxa a exportação do Lovable Cloud (função SQL `export_meufunil` + endereço de arquivos do app). Roda no EC2.
//
//   node scripts/lovable-export/pull.mjs --env <arquivo com SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY> \
//        --token-file <arquivo> --out <pasta> --file-url <https://<app>.lovable.app/api/export-file> [--check-only]
//
// Grava <out>/manifest.json, <out>/tables/<schema>.<tabela>.json e <out>/storage/<bucket>/<caminho> (pasta 700).
// --check-only: só o manifesto e os totais (linhas e arquivos por bucket), para conferir o disco antes de baixar.
// Confere no fim: linhas por tabela = manifesto e todo arquivo baixado com o tamanho certo. Sai 1 se algo não bater.
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : undefined; };
const envText = readFileSync(flag('--env') ?? '', 'utf8');
const envVal = (k) => (envText.match(new RegExp(`^${k}\\s*=\\s*["']?([^"'\\s]+)`, 'm')) ?? [])[1];
const SUPABASE_URL = envVal('SUPABASE_URL')?.replace(/\/+$/, '');
const ANON = envVal('SUPABASE_PUBLISHABLE_KEY') ?? envVal('SUPABASE_ANON_KEY');
const TOKEN = readFileSync(flag('--token-file') ?? '', 'utf8').trim();
const OUT = resolve(flag('--out') ?? './lovable-export');
const FILE_URL = flag('--file-url') ?? '';
const CHECK_ONLY = argv.includes('--check-only');
const PAGE = 1000;
if (!SUPABASE_URL || !ANON) { console.error('faltam SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY no --env'); process.exit(1); }
if (!TOKEN) { console.error('--token-file vazio'); process.exit(1); }

const RPC = `${SUPABASE_URL}/rest/v1/rpc/export_meufunil`;
const rpcHeaders = { apikey: ANON, Authorization: `Bearer ${ANON}`, 'content-type': 'application/json' };

async function comRetry(nome, fn) {
  for (let tentativa = 1; ; tentativa++) {
    const r = await fn();
    if (r.ok) return r;
    const texto = await r.text();
    if (tentativa >= 3 || r.status < 500) throw new Error(`${nome} → HTTP ${r.status}: ${texto.slice(0, 300)}`);
    await new Promise((ok) => setTimeout(ok, 1500 * tentativa));
  }
}

async function rpc(action, schema = null, table = null, limit = 500, offset = 0) {
  const body = JSON.stringify({ p_token: TOKEN, p_action: action, p_schema: schema, p_table: table, p_limit: limit, p_offset: offset });
  const r = await comRetry(`${action} ${schema ?? ''}.${table ?? ''}`, () => fetch(RPC, { method: 'POST', headers: rpcHeaders, body }));
  return r.json();
}

async function file(bucket, name) {
  if (!FILE_URL) throw new Error('falta --file-url para baixar arquivos');
  const u = `${FILE_URL}?bucket=${encodeURIComponent(bucket)}&name=${encodeURIComponent(name)}`;
  const r = await comRetry(`arquivo ${bucket}/${name}`, () => fetch(u, { headers: { 'x-export-token': TOKEN } }));
  return Buffer.from(await r.arrayBuffer());
}

const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;
mkdirSync(OUT, { recursive: true, mode: 0o700 });
chmodSync(OUT, 0o700);
const manifest = await rpc('manifest');
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
const linhas = Object.values(manifest.counts).reduce((a, b) => a + Number(b), 0);
const porBucket = {};
for (const o of manifest.objects) porBucket[o.bucket_id] = (porBucket[o.bucket_id] ?? 0) + 1;
const bytes = manifest.objects.reduce((a, o) => a + Number(o.size ?? 0), 0);
console.log(`manifesto: ${Object.keys(manifest.counts).length} tabelas, ${linhas} linhas`);
console.log(`arquivos: ${manifest.objects.length} (${Object.entries(porBucket).map(([b, n]) => `${b}: ${n}`).join(', ')}), ${mb(bytes)}`);
if (CHECK_ONLY) process.exit(0);

mkdirSync(join(OUT, 'tables'), { recursive: true });
let falhas = 0;
for (const [chave, esperado] of Object.entries(manifest.counts)) {
  const [schema, table] = chave.split('.');
  const rows = [];
  for (let offset = 0; offset < esperado; offset += PAGE) {
    const { rows: pagina } = await rpc('table', schema, table, PAGE, offset);
    rows.push(...pagina);
    if (pagina.length === 0) break;
  }
  writeFileSync(join(OUT, 'tables', `${chave}.json`), JSON.stringify(rows));
  const ok = rows.length === Number(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${chave}: ${rows.length}/${esperado}`);
}

let baixados = 0;
for (const o of manifest.objects) {
  const destino = join(OUT, 'storage', o.bucket_id, o.name);
  if (existsSync(destino) && (o.size == null || statSync(destino).size === Number(o.size))) { baixados++; continue; }
  try {
    const b = await file(o.bucket_id, o.name);
    mkdirSync(dirname(destino), { recursive: true });
    writeFileSync(destino, b);
    if (o.size != null && b.length !== Number(o.size)) { falhas++; console.log(`FALHA tamanho ${o.bucket_id}/${o.name}: ${b.length} ≠ ${o.size}`); }
    baixados++;
  } catch (e) {
    falhas++;
    console.log(`FALHA arquivo ${o.bucket_id}/${o.name}: ${e.message}`);
  }
}
console.log(`arquivos baixados: ${baixados}/${manifest.objects.length} em ${join(OUT, 'storage')}`);
console.log(falhas ? `\n${falhas} falha(s)` : '\nexportação completa e conferida');
process.exit(falhas ? 1 : 0);
```

- [ ] **Step 5: Rodar e ver passar**

Run: `cd api && bash scripts/lovable-export/pull-e2e.sh`
Expected: `8 ok, 0 falha(s)`.

- [ ] **Step 6: Commit**

```bash
git add api/scripts/lovable-export/
git commit -m "feat(migracao): exportação do Lovable — função SQL só-leitura com token, pull conferido (--check-only), prompts e Lovable falso para teste

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Compose, runbook, documentação e verificação final

**Files:**
- Modify: `docker-compose.prod.yml` (volume da API)
- Create: `docs/migracao-lovable.md`
- Modify: `CLAUDE.md` (uma linha nas regras rápidas)

**Interfaces:**
- Consumes: CLI do importador (Task 6/7), `pull.mjs`/`render-prompts.mjs` (Task 8).
- Produces: mount `./lovable-export:/import:ro` na API de produção; runbook com os comandos exatos.

- [ ] **Step 1: Mount da exportação na API**

Em `docker-compose.prod.yml`, no serviço `api`, troque o bloco `volumes:` por:

```yaml
    volumes:
      - meufunil_uploads:/data/uploads
      # Exportação do Lovable (docs/migracao-lovable.md) — só leitura para o importador.
      - ./lovable-export:/import:ro
```

- [ ] **Step 2: Runbook**

`docs/migracao-lovable.md`:

````markdown
# Migração dos dados do Lovable — runbook

Spec: `docs/superpowers/specs/2026-10-06-migracao-lovable-design.md`. Tudo roda no EC2: `ssh ubuntu@56.124.127.54`, `cd /opt/meu-funil`.
O Lovable nunca é escrito; o banco `meufunil` só recebe a carga se estiver vazio.

## 0. Uma vez

```bash
install -d -m 700 /opt/meu-funil/lovable-export
# imagem da API com o importador: deploy normal (docs/deploy.md §2), antes: docker tag meufunil-api:latest meufunil-api:pre-migracao
```

Atalhos usados abaixo:

```bash
DC="docker compose -f docker-compose.prod.yml"
RUN="$DC run --rm --no-deps"
STAMP=$(date +%Y%m%d-%H%M)
```

## 1. Token e prompt (uma vez)

```bash
umask 077; openssl rand -hex 32 | tr -d '\n' > lovable-export/token
HASH=$(sha256sum < lovable-export/token | cut -d' ' -f1); echo "$HASH"   # o hash não é segredo
$RUN api node scripts/lovable-export/render-prompts.mjs --hash "$HASH" --only exportacao
```

O dono cola o prompt no Lovable (cria a função `export_meufunil` e a rota `/api/export-file`, publica) e informa a URL `https://<app>.lovable.app`.
`lovable-export/lovable.env` (600): `SUPABASE_URL=` e `SUPABASE_PUBLISHABLE_KEY=` do `.env` do repositório do Lovable (valores públicos).
Credenciais: o dono acrescenta ao `.env` a linha `LEGACY_CREDENTIALS_ENCRYPTION_KEY=<a CREDENTIALS_ENCRYPTION_KEY do Lovable>` (por SSH, nunca por chat).

## 2. Pull

```bash
PULL="$RUN -v /opt/meu-funil/lovable-export:/out api node scripts/lovable-export/pull.mjs --env /out/lovable.env --token-file /out/token --file-url https://<app>.lovable.app/api/export-file"
$PULL --out /out/$STAMP --check-only          # confira o tamanho contra o disco livre (df -h /)
$PULL --out /out/$STAMP                       # sai 1 se algo não bater: rode de novo (retoma os arquivos já baixados)
```

## 3. Ensaio (banco meufunil_stage)

```bash
docker exec meufunil-postgres psql -U meufunil -d postgres -c 'DROP DATABASE IF EXISTS meufunil_stage WITH (FORCE)' -c 'CREATE DATABASE meufunil_stage'
STAGE="postgresql://meufunil:$(grep '^POSTGRES_PASSWORD=' .env | cut -d= -f2-)@meufunil-postgres:5432/meufunil_stage?schema=public"
$RUN -e DATABASE_URL="$STAGE" api npx prisma migrate deploy
IMP="$RUN -e DATABASE_URL=$STAGE api node dist/src/scripts/import-lovable/main.js --export /import/$STAMP --expect-db meufunil_stage --uploads-dir /data/uploads/.stage"
$IMP --dry-run | tee lovable-export/$STAMP/ensaio-dry-run.txt
$IMP           | tee lovable-export/$STAMP/ensaio-carga.txt
$IMP --verify  | tee lovable-export/$STAMP/ensaio-verify.txt
```

Revisar com o dono: dados não migrados, contas sem login, links mantidos, pendentes vencidos. Depois:

```bash
docker exec meufunil-postgres psql -U meufunil -d postgres -c 'DROP DATABASE meufunil_stage WITH (FORCE)'
$RUN api rm -rf /data/uploads/.stage
```

## 4. Virada

1. O dono avisa os usuários do `*.lovable.app` e congela o uso.
2. Pull novo (§2) com `STAMP` novo.
3. API parada durante a carga (ninguém se cadastra, o agendador não roda):

```bash
$DC stop api
IMP="$RUN api node dist/src/scripts/import-lovable/main.js --export /import/$STAMP --expect-db meufunil --uploads-dir /data/uploads"
$IMP --dry-run | tee lovable-export/$STAMP/virada-dry-run.txt
$IMP           | tee lovable-export/$STAMP/virada-carga.txt
$IMP --verify  | tee lovable-export/$STAMP/virada-verify.txt
$DC up -d api && curl -s http://127.0.0.1:3015/health
```

4. O dono entra em `https://www.meufunildevendas.com.br` com a senha atual e confere empresas, posts, criativos com imagem e CRM.
5. Tirar a chave do Lovable: `sed -i '/^LEGACY_CREDENTIALS_ENCRYPTION_KEY=/d' .env && $DC up -d api`.
6. Prompt de limpeza no Lovable: `$RUN api node scripts/lovable-export/render-prompts.mjs --hash "$HASH" --only limpeza`.
7. Depois da conferência final: `rm -rf lovable-export/<stamps> lovable-export/token lovable-export/lovable.env`.

## Plano de volta

```bash
$DC stop api
docker exec meufunil-postgres psql -U meufunil -d postgres -c 'DROP DATABASE meufunil WITH (FORCE)' -c 'CREATE DATABASE meufunil'
$RUN api sh -c 'rm -rf /data/uploads/creative-assets /data/uploads/ig-media'
$DC up -d api     # aplica as migrations no boot
```

E o DNS: A do apex `meufunildevendas.com.br` de volta para `185.158.133.1` (Lovable).
````

- [ ] **Step 3: CLAUDE.md**

Em `CLAUDE.md`, logo depois do item que começa com `- **Instagram (\`api/src/modules/instagram\`)**` (antes do item `- Prisma:`), acrescente:

```markdown
- **Migração do Lovable** (06/10/2026): importador avulso `api/src/scripts/import-lovable/` (não sobe o Nest; `main.ts` = CLI), exportação em `api/scripts/lovable-export/`
  (SQL `export_meufunil`, `pull.mjs`, prompts), runbook `docs/migracao-lovable.md`. Testes ponta a ponta: `scripts/import-lovable-e2e.sh` (Postgres local, banco
  `meufunil_import_e2e`) e `scripts/lovable-export/pull-e2e.sh`. Nunca rodar contra o banco `meufunil` fora do runbook.
```

- [ ] **Step 4: Verificação final (um pesado por vez)**

Run (de `api/`, com o Postgres local de pé):
1. `../scripts/run-capped.sh 1500 npm test` → Expected: todas as suítes PASS (as anteriores + as 7 novas de `import-lovable`).
2. `../scripts/run-capped.sh 1500 npm run typecheck` → Expected: 0 erros.
3. `../scripts/run-capped.sh 1500 npx eslint src/scripts/import-lovable` → Expected: 0 erros (não usar `--fix`).
4. `../scripts/run-capped.sh 1500 bash scripts/import-lovable-e2e.sh` → Expected: `26 ok, 0 falha(s)`.
5. `bash scripts/lovable-export/pull-e2e.sh` → Expected: `8 ok, 0 falha(s)`.
Depois: `docker compose stop postgres` (raiz).

- [ ] **Step 5: Commit**

```bash
git add docker-compose.prod.yml docs/migracao-lovable.md CLAUDE.md
git commit -m "docs(migracao): runbook da migração do Lovable (token, pull, ensaio, virada, volta) e mount da exportação na API

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Deploy do importador no EC2 e prompt de exportação

Operação (sem código novo). Para entre os passos que dependem do dono.

**Files:** nenhum no repositório (estado no EC2).

**Interfaces:**
- Consumes: branch `feat/migracao-lovable` mergeada na `master` (o dono aprova o merge pela skill finishing-a-development-branch); `docs/deploy.md` §2; `docs/migracao-lovable.md` §0–§1.
- Produces: imagem `meufunil-api:latest` com `dist/src/scripts/import-lovable/main.js`; `/opt/meu-funil/lovable-export/{token,lovable.env}`; prompt de exportação entregue ao dono.

- [ ] **Step 1: Enviar a árvore e reconstruir só a API** — seguir `docs/deploy.md` §2 (tar com exclusões ancoradas, `scp`, `tar xzf` em `/opt/meu-funil`), com `docker tag meufunil-api:latest meufunil-api:pre-migracao` antes e `install -d -m 700 /opt/meu-funil/lovable-export` antes do `up`. Depois: `docker compose -f docker-compose.prod.yml up -d --build api` e `curl -s http://127.0.0.1:3015/health` → Expected: `{"status":"ok",…}`; `docker compose -f docker-compose.prod.yml run --rm --no-deps api ls dist/src/scripts/import-lovable/main.js` → Expected: o caminho.
- [ ] **Step 2: Token e prompt** — `docs/migracao-lovable.md` §1 no EC2: gerar o token (nunca exibido), mostrar só o `HASH`, renderizar o prompt de exportação e entregá-lo ao dono.
- [ ] **Step 3: PARAR** — o dono cola o prompt no Lovable, publica, informa a URL `*.lovable.app` e põe a `LEGACY_CREDENTIALS_ENCRYPTION_KEY` no `.env` do EC2 por SSH.

---

### Task 11: Pull e ensaio

Operação. Só depois da Task 10 Step 3.

**Interfaces:**
- Consumes: URL `*.lovable.app` do dono; `SUPABASE_URL`/`SUPABASE_PUBLISHABLE_KEY` do `.env` do repositório do Lovable (`git show origin/main:.env`, valores públicos) gravados em `/opt/meu-funil/lovable-export/lovable.env` (600).
- Produces: `/opt/meu-funil/lovable-export/<STAMP>/` conferido; relatórios `ensaio-*.txt`; banco `meufunil_stage` descartado no fim.

- [ ] **Step 1: `--check-only`** (runbook §2) → Expected: totais de linhas e de arquivos por bucket; conferir com `df -h /` (precisa caber com folga). Bucket fora de `creative-assets`/`ig-media` → parar e decidir com o dono.
- [ ] **Step 2: Pull completo** → Expected: `exportação completa e conferida` (exit 0).
- [ ] **Step 3: Ensaio** (runbook §3: dry-run → carga → verify) → Expected: dry-run e carga sem `ERRO:`; verify `verificação: ok`. Qualquer `ERRO:` → systematic-debugging; correção vira commit com teste (unit ou e2e) antes de repetir.
- [ ] **Step 4: Revisar o relatório com o dono** — dados não migrados, contas sem login, links mantidos, pendentes vencidos, credenciais. Limpar o ensaio (runbook §3, fim). A virada (runbook §4) só com o OK explícito do dono.
````
