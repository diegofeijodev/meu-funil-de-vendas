import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { isKnownAppPath } from '@/lib/app-routes';
import { config, middleware } from '@/middleware';

const APP_DIR = join(__dirname, '..', 'app', '(app)');

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return pages(full);
    return name === 'page.tsx' ? [full] : [];
  });
}

/** `(app)/brands/[id]/page.tsx` -> `/brands/<id>`; `(app)/page.tsx` não existe (a raiz é `app/page.tsx`). */
const routeOf = (file: string) =>
  '/' + relative(APP_DIR, file).split(sep).slice(0, -1).map((seg) => (seg.startsWith('[') ? 'abc-123' : seg)).join('/');

describe('rotas do (app)', () => {
  const files = pages(APP_DIR);

  it('toda página real é aceita por isKnownAppPath (senão o middleware responderia 404 a uma tela existente)', () => {
    expect(files.length).toBeGreaterThanOrEqual(24);
    expect(files.map(routeOf).filter((r) => !isKnownAppPath(r))).toEqual([]);
  });

  it('não sobrou catch-all `[...x]` (rota desconhecida é decidida pelo middleware)', () => {
    expect(readdirSync(APP_DIR).filter((n) => n.startsWith('[...'))).toEqual([]);
  });
});

describe('middleware', () => {
  const run = (path: string) => middleware(new NextRequest(new URL(path, 'http://localhost:3025')));

  it('rota conhecida segue; desconhecida vira 404 (rewrite para /nao-encontrada)', () => {
    expect(run('/crm/leads').headers.get('x-middleware-next')).toBe('1');
    expect(run('/brands/abc').headers.get('x-middleware-next')).toBe('1');
    const nf = run('/nada-aqui');
    expect(nf.status).toBe(404);
    expect(nf.headers.get('x-middleware-rewrite')).toContain('/nao-encontrada');
  });

  it('o matcher exclui `_next/`, `api/` (e `/api`), arquivos com ponto — mas não rotas que só começam com esses nomes', () => {
    const re = new RegExp('^' + config.matcher[0]!.replace(/\((?=\?!)/, '(') + '$');
    const hit = (p: string) => re.test(p);
    expect(hit('/api/public/forms/x')).toBe(false);
    expect(hit('/api')).toBe(false);
    expect(hit('/_next/static/a.js')).toBe(false);
    expect(hit('/logo.png')).toBe(false);
    expect(hit('/apis')).toBe(true);
    expect(hit('/next-steps')).toBe(true);
    expect(hit('/crm/leads')).toBe(true);
  });
});
