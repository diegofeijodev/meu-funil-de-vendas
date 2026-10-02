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
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

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
const REDE_IGNORADA = [
  { url: /[?&]_rsc=/, erro: 'net::ERR_ABORTED' },
  // `next dev` recompilando a página pedida: o navegador aborta o `hot-update.js` anterior.
  { url: /\/_next\/static\/webpack\/.*\.hot-update\.js$/, erro: 'net::ERR_ABORTED' },
  // Navegar para outra tela enquanto o checklist (`setup/status`, ~1 s) ainda carrega cancela o XHR.
  { url: /\/v1\/setup\/status$/, erro: 'net::ERR_ABORTED' },
];
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
/** `innerText` aplica o `uppercase` do CSS nos rótulos: compara sem diferenciar caixa. */
const tem = (txt, t) => txt.toLowerCase().includes(t.toLowerCase());
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
  for (let k = erros.length - 1; k >= 0; k--) {
    if (erros[k].startsWith('[http 400] POST api/v1/auth/login') || erros[k].includes('400 (Bad Request)')) erros.splice(k, 1);
  }

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
  const fontes = await page.evaluate(() => ({
    corpo: getComputedStyle(document.body).fontFamily,
    h: getComputedStyle(document.querySelector('h1,h2,h3,.font-display')).fontFamily,
  }));
  check('fonte do corpo é a Inter do next/font', /inter/i.test(fontes.corpo.split(',')[0]), fontes.corpo);
  check('fonte display (Manrope) aplicada em .font-display', /manrope/i.test(fontes.h.split(',')[0]), fontes.h);
  check('tab title do root', (await page.title()).includes('Meu Funil'), await page.title());

  // ── 2b. Task 2: Overview, Marcas, Configurações, Agência ───────
  const tmp = mkdtempSync(path.join(tmpdir(), 'mf-bc-'));
  const esperaShell = () => page.waitForFunction(() => !!document.querySelector('aside select')?.value, null, { timeout: 30000 });
  /** Tira dos erros coletados o que o próprio passo provoca de propósito (HTTP + eco no console). */
  const esperado = (re) => {
    for (let k = erros.length - 1; k >= 0; k--) if (re.test(erros[k])) erros.splice(k, 1);
  };

  console.log('-- Overview --');
  await page.goto(`${BASE}/overview`);
  await esperaShell();
  await page.getByText('Investimento (período)').waitFor({ timeout: 30000 });
  const txtOv = await corpo();
  for (const t of ['Overview', 'Nova campanha', 'Atualizar da Meta', 'Receita atribuída', 'ROAS', 'ROI', 'CAC médio', 'Campanhas ativas', 'Melhor campanha', 'Evolução diária', 'AI Insights', 'Melhor criativo', 'Status atual do portfólio']) {
    check(`overview mostra "${t}"`, tem(txtOv, t));
  }
  check('overview: título da aba', (await page.title()) === 'Overview · Meu Funil', await page.title());
  const aguardaChecklist = await page.getByText(/passos essenciais concluídos/).first().waitFor({ timeout: 15000 }).then(() => true, () => false);
  check('overview: checklist de configuração (compacto) aparece enquanto faltam passos', aguardaChecklist);
  check('overview: 8 cartões de KPI', (await page.locator('.grid.sm\\:grid-cols-2.xl\\:grid-cols-4 > *').count()) >= 8);

  console.log('-- Marcas --');
  const marca = `Marca Check ${Date.now()}`;
  await page.goto(`${BASE}/brands`);
  await page.getByRole('heading', { name: 'Brands' }).waitFor({ timeout: 30000 });
  check('brands: título da aba', (await page.title()) === 'Brands · Meu Funil', await page.title());
  check('brands: explicação do Brand Brain', tem(await corpo(), 'Como o Brand Brain é usado'));
  await page.getByRole('button', { name: 'Nova marca' }).click();
  await page.fill('#bname', marca);
  await page.fill('#bseg', 'Segmento check');
  await page.getByRole('button', { name: 'Criar marca' }).click();
  await page.getByText('Marca criada. Complete o Brand Brain.').waitFor({ timeout: 15000 });
  await page.waitForURL(/\/brands\/[0-9a-f-]{36}$/, { timeout: 15000 });
  const brandUrl = page.url();
  check('criar marca leva a /brands/:id', /\/brands\/[0-9a-f-]{36}$/.test(rel()), rel());
  await page.getByRole('heading', { name: marca }).waitFor({ timeout: 15000 });
  check('detalhe: título da aba', (await page.title()) === 'Brand Kit · Meu Funil', await page.title());
  for (const t of ['Voltar', 'Salvar Brand Brain', 'DNA', 'Identidade visual', 'Guia visual', 'Produtos', 'Personas', 'Aprendizados', 'Negócio', 'Linguagem']) {
    check(`detalhe mostra "${t}"`, tem(await corpo(), t));
  }

  // DNA: salvar e recarregar
  await page.fill('#description', 'Descrição do check');
  await page.fill('#pw', 'chopp, gelado');
  await page.getByRole('button', { name: 'Salvar Brand Brain' }).click();
  await page.getByText('Brand Brain atualizado. Os agentes já usam o novo contexto.').waitFor({ timeout: 15000 });
  await page.reload();
  await page.locator('#description').waitFor({ timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('#description')?.value === 'Descrição do check', null, { timeout: 15000 });
  check('DNA persistido (descrição e palavras)', (await page.inputValue('#pw')) === 'chopp, gelado');

  // Identidade visual: cores, logo, fonte (envio pela API) e remoção
  await page.getByRole('tab', { name: 'Identidade visual' }).click();
  await page.fill('#ty', 'Archivo Black');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  writeFileSync(path.join(tmp, 'logo.png'), png);
  writeFileSync(path.join(tmp, 'ref.png'), png);
  writeFileSync(path.join(tmp, 'Marca.ttf'), Buffer.concat([Buffer.from([0, 1, 0, 0]), Buffer.from('fontbytes')]));
  const logoInput = page.locator('label', { hasText: /^\s*Logo\s*$/ }).locator('input[type=file]');
  await logoInput.setInputFiles(path.join(tmp, 'logo.png'));
  await page.getByText('Arquivo enviado.').first().waitFor({ timeout: 20000 });
  const imgLogo = page.locator('img[alt="logo.png"]');
  await imgLogo.waitFor({ timeout: 15000 });
  check('logo enviado aparece e a imagem carrega (URL assinada da API)', await imgLogo.evaluate((i) => i.complete && i.naturalWidth > 0));
  const fontInput = page.locator('label', { hasText: 'Fonte (.ttf/.otf)' }).locator('input[type=file]');
  await fontInput.setInputFiles(path.join(tmp, 'Marca.ttf'));
  await page.getByText('Aa · Marca.ttf').waitFor({ timeout: 20000 });
  ok('fonte .ttf enviada (cartão "Aa · Marca.ttf")');
  check('rótulos dos arquivos (Logo / Fonte)', (await corpo()).includes('Logo') && (await corpo()).includes('Fonte (.ttf/.otf)'));
  // arquivo inválido: o próprio navegador avisa antes de enviar
  writeFileSync(path.join(tmp, 'x.txt'), 'texto');
  await page.locator('label', { hasText: 'Identidade visual' }).last().locator('input[type=file]').setInputFiles(path.join(tmp, 'x.txt'));
  await page.getByText('x.txt: envie uma imagem (JPG, PNG, SVG, WEBP) ou PDF.').waitFor({ timeout: 10000 });
  ok('arquivo .txt é recusado com a mensagem do protótipo');
  // remover os dois
  const removers = page.getByRole('button', { name: 'Remover' });
  check('2 arquivos listados', (await removers.count()) === 2, String(await removers.count()));
  await removers.first().click();
  await page.waitForFunction(() => document.querySelectorAll('button[aria-label="Remover"]').length === 1, null, { timeout: 10000 });
  await page.getByRole('button', { name: 'Remover' }).first().click();
  await page.getByText('Nenhum arquivo enviado ainda.').waitFor({ timeout: 10000 });
  ok('arquivos removidos');

  // Guia visual: sem foto de referência a IA devolve a mensagem do protótipo (HTTP 400 esperado)
  await page.getByRole('tab', { name: 'Guia visual' }).click();
  await page.getByPlaceholder('fotografia gastronômica realista, close, fundo de bar de madeira').fill('estilo do check');
  await page.getByRole('button', { name: 'Gerar guia com IA' }).click();
  await page.getByText('Envie ao menos uma foto de referência (produto, ambiente ou equipe).').waitFor({ timeout: 15000 });
  ok('"Gerar guia com IA" sem referência mostra a mensagem do protótipo');
  esperado(/generate-brand-guide|400 \(Bad Request\)/);
  await page.getByRole('button', { name: 'Salvar guia visual' }).click();
  await page.getByText('Guia visual salvo. Os próximos criativos já seguem este guia.').waitFor({ timeout: 15000 });
  await page.reload();
  await page.getByRole('tab', { name: 'Guia visual' }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('input')].some((i) => i.value === 'estilo do check'), null, { timeout: 15000 });
  ok('guia visual persistido');

  // Produtos
  await page.getByRole('tab', { name: 'Produtos' }).click();
  await page.getByText('Nenhum produto cadastrado.').waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: 'Adicionar' }).click();
  const linhaProd = page.locator('div.rounded-lg', { has: page.getByRole('button', { name: 'Remover' }) }).first();
  await linhaProd.waitFor({ timeout: 10000 });
  await linhaProd.locator('input').nth(0).fill('Chopp do check');
  await linhaProd.locator('input').nth(2).fill('12.5');
  await linhaProd.getByRole('button', { name: 'Salvar' }).click();
  await page.getByText('Produto salvo').waitFor({ timeout: 10000 });
  await page.reload();
  await page.getByRole('tab', { name: 'Produtos' }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('input')].some((i) => i.value === 'Chopp do check'), null, { timeout: 15000 });
  check('produto salvo e persistido (preço no rodapé)', (await corpo()).includes('Preço atual: R$') && (await corpo()).includes('12,50'));
  await page.getByRole('button', { name: 'Remover' }).first().click();
  await page.getByText('Nenhum produto cadastrado.').waitFor({ timeout: 10000 });
  ok('produto removido');

  // Personas
  await page.getByRole('tab', { name: 'Personas' }).click();
  await page.getByText('Nenhuma persona cadastrada.').waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: 'Adicionar' }).click();
  const linhaPer = page.locator('div.rounded-lg', { has: page.getByRole('button', { name: 'Remover' }) }).first();
  await linhaPer.waitFor({ timeout: 10000 });
  await linhaPer.locator('input').nth(0).fill('Ana do check');
  await linhaPer.getByRole('button', { name: 'Salvar' }).click();
  await page.getByText('Persona salva').waitFor({ timeout: 10000 });
  await page.reload();
  await page.getByRole('tab', { name: 'Personas' }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('input')].some((i) => i.value === 'Ana do check'), null, { timeout: 15000 });
  ok('persona salva e persistida');
  await page.getByRole('button', { name: 'Remover' }).first().click();
  await page.getByText('Nenhuma persona cadastrada.').waitFor({ timeout: 10000 });
  ok('persona removida');

  await page.getByRole('tab', { name: 'Aprendizados' }).click();
  await page.getByText('Nenhum aprendizado registrado ainda.').waitFor({ timeout: 10000 });
  ok('aprendizados: estado vazio');

  // lista: cartão com segmento, contagens e exclusão pelo diálogo
  await page.goto(`${BASE}/brands`);
  const cartao = page.locator('a[href^="/brands/"]', { hasText: marca });
  await cartao.waitFor({ timeout: 30000 });
  const txtCartao = await cartao.innerText();
  check('cartão mostra segmento e contagens', txtCartao.includes('Segmento check') && txtCartao.includes('0 campanhas') && txtCartao.includes('0 produtos'), txtCartao);
  check('cartão mostra a descrição salva', txtCartao.includes('Descrição do check'));
  await cartao.getByRole('button', { name: 'Excluir' }).click();
  await page.getByRole('heading', { name: 'Excluir marca' }).waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: 'Excluir marca' }).click();
  await page.getByText(`Marca "${marca}" excluída.`).waitFor({ timeout: 15000 });
  await page.waitForFunction((m) => !document.body.innerText.includes(m) || document.body.innerText.includes(`Marca "${m}" excluída.`), marca, { timeout: 10000 });
  check('marca excluída some da lista', (await page.locator('a[href^="/brands/"]', { hasText: marca }).count()) === 0);
  await page.goto(brandUrl);
  await page.waitForTimeout(1500);
  check('marca excluída: detalhe não carrega (skeleton)', (await page.locator('h1').count()) === 0 || !(await page.locator('h1').first().innerText()).includes(marca));
  // o GET 404 da marca excluída é provocado de propósito
  esperado(/\[http 404\]|404 \(Not Found\)/);

  console.log('-- Configurações --');
  await page.goto(`${BASE}/settings`);
  await page.getByRole('heading', { name: 'Configurações' }).waitFor({ timeout: 30000 });
  await page.getByText('Time e permissões').waitFor({ timeout: 30000 });
  await page.getByText(/^desde /).first().waitFor({ timeout: 15000 });
  await page.getByText(/passos essenciais concluídos/).first().waitFor({ timeout: 15000 });
  const txtSet = await corpo();
  for (const t of ['Workspace', 'Seu perfil', 'Time e permissões', 'Segurança dos dados', 'Plano:', 'desde', 'Owner', EMAIL]) check(`settings mostra "${t}"`, tem(txtSet, t));
  check('settings: título da aba', (await page.title()) === 'Configurações · Meu Funil', await page.title());
  check('settings: checklist completo ("Ver tudo"/"Recolher")', txtSet.includes('Recolher') || txtSet.includes('Ver tudo'));
  const nomeOriginal = await page.inputValue('#fn');
  await page.fill('#fn', 'Nome Check');
  await page.getByRole('button', { name: 'Salvar' }).nth(1).click();
  await page.getByText('Perfil atualizado.').waitFor({ timeout: 10000 });
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#fn')?.value === 'Nome Check', null, { timeout: 15000 });
  ok('perfil: nome salvo e persistido');
  await page.fill('#fn', nomeOriginal);
  await page.getByRole('button', { name: 'Salvar' }).nth(1).click();
  await page.getByText('Perfil atualizado.').waitFor({ timeout: 10000 });
  const wsOriginal = await page.inputValue('#wn');
  await page.fill('#wn', `${wsOriginal} Check`);
  await page.getByRole('button', { name: 'Salvar' }).first().click();
  await page.getByText('Workspace atualizado.').waitFor({ timeout: 10000 });
  await page.waitForFunction((n) => [...document.querySelectorAll('aside select option')].some((o) => o.textContent === n), `${wsOriginal} Check`, { timeout: 15000 });
  ok('workspace renomeado (aparece no seletor do menu)');
  await page.fill('#wn', wsOriginal);
  await page.getByRole('button', { name: 'Salvar' }).first().click();
  await page.getByText('Workspace atualizado.').waitFor({ timeout: 10000 });
  await page.waitForFunction((n) => [...document.querySelectorAll('aside select option')].some((o) => o.textContent === n), wsOriginal, { timeout: 15000 });
  ok('nome do workspace restaurado');

  console.log('-- Agência --');
  await page.goto(`${BASE}/agency`);
  await page.getByRole('heading', { name: 'Agência' }).waitFor({ timeout: 30000 });
  await page.getByText('Gasto 30d').waitFor({ timeout: 30000 });
  const txtAg = await corpo();
  for (const t of ['empresa(s)', 'Leads anúncio', 'CPL', 'ROAS', 'Campanhas ativas', 'Leads CRM 7d', 'Posts da semana', 'Pendências', 'Abrir', 'Meu Funil Demo', 'Total:']) check(`agência mostra "${t}"`, tem(txtAg, t));
  check('agência: título da aba', (await page.title()) === 'Agência · Meu Funil', await page.title());
  await page.getByRole('button', { name: 'Abrir' }).first().click();
  await page.waitForURL('**/overview', { timeout: 15000 });
  check('"Abrir" troca a empresa e vai para /overview', rel() === '/overview', rel());
  rmSync(tmp, { recursive: true, force: true });

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
