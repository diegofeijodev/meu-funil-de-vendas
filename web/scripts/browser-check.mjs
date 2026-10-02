// Passeio headless pelo Meu Funil (Task 1, fundação do web): entra pelo
// FORMULÁRIO com a conta do seed, confere o shell (logo, menu, empresa, papel),
// navega por itens do menu (placeholders), checa 404, guarda de sessão e "Sair".
// Qualquer erro de console, `pageerror`, falha de rede (`requestfailed`) e
// resposta HTTP >= 400 derrubam a rodada. Cresce a cada tarefa.
//
// Requer a API na 3015 (`npm run start:smoke` em `api/`, Postgres de pé com
// `docker compose up -d postgres` na raiz) e o web na 3025 (`yarn dev`) — nunca
// `next build` (ver CLAUDE.md, "Regras de baixo consumo").
//
//   node scripts/browser-check.mjs
import { chromium } from '/home/doutor/coding/freela/freela-web-v2/node_modules/playwright/index.mjs';

const BASE = 'http://localhost:3025';
const API = 'http://localhost:3015';
const EMAIL = process.env.MEUFUNIL_CHECK_EMAIL ?? 'demo@meufunil.local';
const SENHA = process.env.MEUFUNIL_CHECK_PASSWORD ?? 'meufunil123';

/**
 * Respostas >= 400 que NÃO são o app quebrado — lista fechada, com motivo.
 * `hot-update.json`: o `next dev` recompila e o navegador pede um pedaço de HMR
 * que já não existe.
 */
const IGNORADAS = [/\/_next\/static\/webpack\/.*\.hot-update\.json$/];
const ignorada = (url) => IGNORADAS.some((re) => re.test(url));

/**
 * Falhas de REDE que não são o app quebrado: `_rsc` + `ERR_ABORTED` = o roteador
 * do Next cancelando um pré-carregamento de `<Link>` quando a navegação acontece
 * antes dele terminar. Erro de verdade no mesmo pedido viria como HTTP >= 400.
 */
const REDE_IGNORADA = [{ url: /[?&]_rsc=/, erro: 'net::ERR_ABORTED' }];
const redeIgnorada = (url, erro) =>
  ignorada(url) || REDE_IGNORADA.some((r) => r.url.test(url) && erro === r.erro);

const erros = [];
let passou = 0;
const ok = (m) => {
  passou += 1;
  console.log(`  OK    ${m}`);
};
const ko = (m, detalhe = '') => {
  erros.push(detalhe ? `${m} — ${detalhe}` : m);
  console.log(`  FALHA ${m}${detalhe ? ` — ${detalhe}` : ''}`);
};
const check = (nome, cond, detalhe = '') => (cond ? ok(nome) : ko(nome, detalhe));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
const page = await ctx.newPage();
const rel = () => page.url().replace(BASE, '') || '/';

page.on('console', (m) => {
  if (m.type() === 'error') erros.push(`[console] ${rel()}: ${m.text().slice(0, 200)}`);
});
page.on('pageerror', (e) => erros.push(`[pageerror] ${rel()}: ${String(e).slice(0, 200)}`));
page.on('response', (r) => {
  if (r.status() >= 400 && !ignorada(r.url())) {
    erros.push(`[http ${r.status()}] ${r.request().method()} ${r.url().replace(API, 'api')}`);
  }
});
page.on('requestfailed', (r) => {
  const erro = r.failure()?.errorText ?? '?';
  if (!redeIgnorada(r.url(), erro)) erros.push(`[rede] ${r.method()} ${r.url().replace(API, 'api')} — ${erro}`);
});

const corpo = async () => await page.locator('body').innerText();
const sessaoGuardada = () => page.evaluate(() => !!window.localStorage.getItem('authUser'));

try {
  // ── 1. "/" sem sessão -> /auth (login pelo formulário) ─────────
  console.log('-- Entrada --');
  await page.goto(`${BASE}/`);
  await page.waitForURL('**/auth', { timeout: 30000 });
  check('/ sem sessão redireciona para /auth', rel() === '/auth', rel());
  check('tab title "Entrar · Meu Funil"', (await page.title()) === 'Entrar · Meu Funil', await page.title());
  const txtAuth = await corpo();
  check('tela de auth abre em "Criar conta"', txtAuth.includes('Criar conta') && txtAuth.includes('Seu nome'));
  check('logo do Meu Funil carrega', await page.locator('img[alt^="Meu Funil"]').first().evaluate((i) => i.complete && i.naturalWidth > 0));

  // guarda de sessão: /overview sem sessão volta para /auth e não monta o shell
  await page.goto(`${BASE}/overview`);
  await page.waitForURL('**/auth', { timeout: 30000 });
  check('/overview sem sessão volta para /auth', rel() === '/auth');

  // senha errada: toast com a mensagem mapeada
  await page.getByText('Entrar', { exact: true }).last().click(); // alterna para "Entrar"
  await page.fill('#email', EMAIL);
  await page.fill('#password', 'senha-errada-123');
  await page.getByRole('button', { name: /Entrar no Meu Funil/ }).click();
  await page.getByText('E-mail ou senha incorretos.').waitFor({ timeout: 15000 });
  ok('senha errada mostra "E-mail ou senha incorretos."');
  // o 400 do login errado é esperado nesta etapa
  const i400 = erros.findIndex((e) => e.startsWith('[http 400] POST api/v1/auth/login'));
  const i400c = erros.findIndex((e) => e.includes('400 (Bad Request)'));
  if (i400 >= 0) erros.splice(i400, 1);
  if (i400c >= 0) erros.splice(i400c > i400 ? i400c - 1 : i400c, 1);

  // Google sem credenciais: 503 -> mesmo toast do protótipo (sem navegar)
  await page.getByRole('button', { name: 'Continuar com Google' }).click();
  await page.getByText('Não foi possível entrar com o Google.').waitFor({ timeout: 15000 });
  check('Google sem credenciais mostra o toast e fica em /auth', rel() === '/auth');
  for (let k = erros.length - 1; k >= 0; k--) {
    if (erros[k].includes('/v1/auth/google') || erros[k].includes('503')) erros.splice(k, 1);
  }

  // login certo
  await page.fill('#password', SENHA);
  await page.getByRole('button', { name: /Entrar no Meu Funil/ }).click();
  await page.waitForURL('**/overview', { timeout: 30000 });
  check('login pelo formulário leva a /overview', rel() === '/overview', rel());
  check('sessão guardada em localStorage["authUser"]', await sessaoGuardada());

  // ── 2. shell ───────────────────────────────────────────────────
  console.log('-- Shell --');
  await page.getByText(EMAIL).first().waitFor({ timeout: 30000 });
  const aside = page.locator('aside').first();
  // as empresas vêm da API depois do primeiro render: espera o seletor ter valor
  await page.waitForFunction(() => !!document.querySelector('aside select')?.value, null, { timeout: 30000 });
  const txtShell = await aside.innerText();
  for (const label of [
    'Agência', 'Overview', 'Brands', 'Creative Studio', 'Biblioteca', 'Instagram', 'Campaigns', 'CRM',
    'Performance', 'AI Insights', 'Approvals', 'Integrations', 'Settings', 'Empresa', 'Sair',
  ]) {
    check(`menu mostra "${label}"`, txtShell.toLowerCase().includes(label.toLowerCase()));
  }
  check('papel "Owner" exibido', txtShell.includes('Owner'), txtShell);
  check('e-mail do usuário exibido', txtShell.includes(EMAIL));
  check('logo do shell carrega', await aside.locator('img').first().evaluate((i) => i.complete && i.naturalWidth > 0));
  const opcoes = await aside.locator('select option').allInnerTexts();
  check('seletor de empresa lista "Meu Funil Demo" e "+ Nova empresa"', opcoes.includes('Meu Funil Demo') && opcoes.includes('+ Nova empresa'), opcoes.join('|'));
  check('item ativo (Overview) destacado', (await aside.locator('a', { hasText: 'Overview' }).getAttribute('class')).includes('bg-sidebar-accent'));
  check('tab title do root', (await page.title()).includes('Meu Funil'), await page.title());

  // ── 3. navegação por placeholders ──────────────────────────────
  console.log('-- Navegação --');
  for (const [label, path] of [['CRM', '/crm'], ['Campaigns', '/campaigns'], ['Settings', '/settings']]) {
    await aside.locator('a', { hasText: label }).click();
    await page.waitForURL(`**${path}`, { timeout: 15000 });
    check(`menu "${label}" navega para ${path} sem 404`, !(await corpo()).includes('Page not found') && (await aside.isVisible()));
  }
  await page.goto(`${BASE}/crm/leads/00000000-0000-4000-8000-000000000001`);
  await page.waitForFunction(() => !!document.querySelector('aside select')?.value, null, { timeout: 30000 });
  ok('rota dinâmica /crm/leads/:id abre o shell');

  // workspace persistido como no protótipo
  const ws = await page.evaluate(() => window.localStorage.getItem('aimos.workspace'));
  check('empresa atual lida da API (localStorage["aimos.workspace"] só após escolher)', ws === null || ws.length > 10);

  // ── 4. 404 do root ─────────────────────────────────────────────
  console.log('-- 404 --');
  const r404 = await page.goto(`${BASE}/nao-existe-xyz`);
  await page.getByText('Page not found').waitFor({ timeout: 15000 });
  check('rota desconhecida mostra o 404 do protótipo, sem shell', (await page.locator('aside').count()) === 0);
  void r404; // o status HTTP do documento fica 200 (a página já começou a transmitir); o que vale é a tela
  // o 404 do próprio documento é esperado
    for (let k = erros.length - 1; k >= 0; k--) if (erros[k].includes('404 (Not Found)')) erros.splice(k, 1);

  // ── 4b. refresh no 401 ─────────────────────────────────────────
  console.log('-- Refresh de token --');
  await page.goto(`${BASE}/overview`);
  await page.waitForFunction(() => !!document.querySelector('aside select')?.value, null, { timeout: 30000 });
  const antes = await page.evaluate(() => JSON.parse(window.localStorage.getItem('authUser')).access_token);
  await page.evaluate(() => {
    const s = JSON.parse(window.localStorage.getItem('authUser'));
    s.access_token = 'token.invalido.x';
    window.localStorage.setItem('authUser', JSON.stringify(s));
  });
  await page.reload();
  await page.waitForFunction(() => !!document.querySelector('aside select')?.value, null, { timeout: 30000 });
  const depois = await page.evaluate(() => JSON.parse(window.localStorage.getItem('authUser')).access_token);
  check('401 com token ruim: refresh uma vez e a tela carrega', rel() === '/overview' && depois !== 'token.invalido.x' && depois !== antes, rel());
  // o 401 provocado de propósito é esperado
  for (let k = erros.length - 1; k >= 0; k--) {
    if (erros[k].startsWith('[http 401]') || erros[k].includes('401 (Unauthorized)')) erros.splice(k, 1);
  }

  // ── 5. "/" logado e Sair ───────────────────────────────────────
  console.log('-- Sessão --');
  await page.goto(`${BASE}/`);
  await page.waitForURL('**/overview', { timeout: 30000 });
  check('/ com sessão vai para /overview', rel() === '/overview');
  await page.getByRole('button', { name: /Sair/ }).first().click({ timeout: 8000 });
  await page.waitForURL('**/auth', { timeout: 30000 });
  check('Sair volta para /auth e limpa a sessão', rel() === '/auth' && !(await sessaoGuardada()));
} catch (e) {
  erros.push(`[script] ${String(e).slice(0, 400)}`);
}

await browser.close();
console.log(`\n${passou} ok, ${erros.length} falha(s)`);
if (erros.length) {
  for (const e of erros) console.log(`  - ${e}`);
  process.exit(1);
}
