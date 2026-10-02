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
//
// Task 3 (campanhas): a API deve subir com o gateway de IA FALSO que este script levanta na 3099:
//   AI_GATEWAY_URL=http://127.0.0.1:3099/v1 AI_GATEWAY_API_KEY=fake npm run start:smoke
// (sem isso a seção de campanhas detecta "IA do app não configurada" e testa o caminho sem IA).
import { chromium } from '/home/doutor/coding/freela/freela-web-v2/node_modules/playwright/index.mjs';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
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


// ── Gateway de IA falso (OpenAI-compatível) — nenhuma chamada de rede externa ─────────────
const fakeAi = { strategy: 0, copy: 0, prompts: [] };
const estrategia = (n) => ({
  resumo_executivo: `Resumo v${n}`, problema: 'Poucos clientes na semana', objetivo_smart: 'Dobrar leads em 30 dias', icp: 'Adultos 25-45',
  oferta: 'Chopp em dobro', big_idea: `Big idea v${n}`, mensagem_principal: 'Venha beber junto', funil: 'Topo ao fundo', canais: 'Meta Ads',
  plano_testes: 'Teste A/B de ganchos', cronograma: 'Semana 1: subir; semana 2: otimizar', hipoteses: ['Humor converte mais'], recomendacoes: ['Começar com 3 criativos'],
  objecoes: [{ objecao: 'Está caro', resposta: 'Chopp em dobro compensa' }],
  distribuicao_verba: [{ destino: 'Meta', percentual: 100 }], kpis: [{ nome: 'CPL', meta: 'R$ 10' }],
  angulos_detalhados: [{ nome: 'Dobradinha', dor_ou_desejo: 'economia', mensagem: 'Chopp em dobro', gancho: 'Dobrou o chopp', formato_sugerido: 'reels', etapa_funil: 'topo' }],
  publicos_meta: [{ nome: 'Público frio', tipo: 'frio', interesses: ['bar'], descricao: 'Quem curte bar' }],
  briefing_criativo: { direcao_visual: 'Copos cheios na mesa', formatos: ['story'], quantidade_por_angulo: 2, cta: 'Venha hoje' },
  briefing_video: { duracao_segundos: 15, roteiro: 'Brinde final', cenas: ['Abertura', 'Brinde'] },
  plano_instagram: { pilares: [{ nome: 'Bastidores', peso: 0.75 }, { nome: 'Promoções', peso: 0.25 }], temas: ['Tema 1'], frequencia: { feed: 5, reels: 3, stories: 10 } },
});
const copia = (n) => ({
  headline: `Headline v${n}`, headline_variacoes: ['v1', 'v2', 'v3', 'v4', 'v5'], texto_curto: 'Texto curto', texto_longo: 'Texto longo', cta: 'Venha hoje',
  meta_ad: 'Anúncio Meta', instagram_feed: 'Feed', reels: '0-3s abertura', stories: 'Story 1', script_ugc: 'UGC', script_institucional: 'Institucional',
  carrossel: ['s1', 's2', 's3', 's4', 's5', 's6', 's7'], quiz: [{ pergunta: 'Qual chopp?', opcoes: ['Claro', 'Escuro', 'Misto'] }],
});
const gateway = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : {};
    const name = body.response_format?.json_schema?.name;
    const prompt = String(body.messages?.[0]?.content ?? '');
    fakeAi.prompts.push({ name, prompt });
    let out = {};
    if (name === 'campaign_strategy') out = estrategia(++fakeAi.strategy);
    else if (name === 'copy') out = copia(++fakeAi.copy);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(out) } }] }));
  });
});
await new Promise((resolve) => gateway.listen(3099, '127.0.0.1', resolve)).catch(() => {});

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


  // ── 2c. Task 3: Campanhas, estrategista, copy engine, aprovações ─
  console.log('-- Campanhas, estrategista, aprovações --');
  /** Chamada autenticada à API a partir da página (token da sessão). */
  const apiCall = (method, p, body) =>
    page.evaluate(
      async ([base, m, path, b]) => {
        const t = JSON.parse(window.localStorage.getItem('authUser')).access_token;
        const headers = { Authorization: `Bearer ${t}`, ...(b ? { 'Content-Type': 'application/json' } : {}) };
        const r = await fetch(base + path, { method: m, headers, body: b ? JSON.stringify(b) : undefined });
        const txt = await r.text();
        return { status: r.status, body: txt ? JSON.parse(txt) : null };
      },
      [API, method, p, body ?? null],
    );
  // `fullDate` do protótipo faz `new Date('YYYY-MM-DD').toLocaleDateString('pt-BR')`: no fuso do navegador (Brasília) sai um dia antes.
  const fmtData = (iso) => page.evaluate((d) => new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }), iso);
  const d1 = await fmtData('2026-10-05');
  const d2 = await fmtData('2026-11-05');
  const marcaNome = `Marca Camp ${Date.now()}`;
  const campNome = `Campanha Check ${Date.now()}`;
  const wsId = (await apiCall('GET', '/v1/workspaces')).body[0].workspace_id;
  const mrc = (await apiCall('POST', `/v1/workspaces/${wsId}/brands`, { name: marcaNome, segment: 'Bar' })).body;
  await apiCall('PATCH', `/v1/workspaces/${wsId}/brands/${mrc.id}`, { tone_of_voice: 'descontraído', preferred_words: ['chopp'] });
  const aiLive = (await apiCall('POST', '/v1/copy-ai/generate-copy-with-ai', { workspaceId: wsId, brand: {}, brief: {} })).status === 200;
  esperado(/generate-copy-with-ai|502|AI_NOT_CONFIGURED/);
  check('API com o gateway de IA falso (AI_GATEWAY_URL=http://127.0.0.1:3099/v1)', aiLive, 'sem o gateway falso o teste de IA roda no modo "sem IA"');
  fakeAi.strategy = 0; fakeAi.copy = 0; fakeAi.prompts.length = 0;

  // lista
  await page.goto(`${BASE}/campaigns`);
  await page.getByRole('heading', { name: 'Campanhas' }).waitFor({ timeout: 30000 });
  await page.getByRole('link', { name: 'Nova campanha' }).waitFor({ timeout: 15000 });
  check('campanhas: título da aba', (await page.title()) === 'Campanhas · Meu Funil', await page.title());
  check('campanhas: subtítulo do protótipo', tem(await corpo(), 'Briefing, estratégia, copies, criativos e publicação'));

  // wizard
  await page.getByRole('link', { name: 'Nova campanha' }).click();
  await page.waitForURL('**/campaigns/new', { timeout: 15000 });
  await page.getByRole('heading', { name: 'Nova campanha' }).waitFor({ timeout: 15000 });
  check('wizard: título da aba', (await page.title()) === 'Nova campanha · Meu Funil', await page.title());
  const txtWiz = await corpo();
  for (const t of ['1. Objetivo', '2. Oferta', '3. Público', '4. Verba e metas', '5. Formatos', 'Marca', 'Nome da campanha', 'Reconhecimento', 'Vendas / Conversão', 'Cancelar']) check(`wizard mostra "${t}"`, tem(txtWiz, t));
  const continuar = page.getByRole('button', { name: 'Continuar' });
  await page.locator('.panel select').first().selectOption({ label: marcaNome });
  check('wizard: "Continuar" desabilitado sem nome', await continuar.isDisabled());
  await page.fill('#cname', campNome);
  await page.getByRole('button', { name: 'Vendas / Conversão' }).click();
  await page.fill('#sd', '2026-10-05');
  await page.fill('#ed', '2026-11-05');
  check('wizard: com nome, "Continuar" habilita', await continuar.isEnabled());
  await continuar.click();
  check('wizard: passo 2 — Oferta', await page.locator('#op').isVisible() && await continuar.isDisabled());
  await page.fill('#op', 'Chopp artesanal');
  await page.fill('#opr', '12.5');
  await page.fill('#opm', 'O melhor chopp da cidade');
  await page.fill('#ol', 'https://exemplo.com.br');
  await continuar.click();
  check('wizard: passo 3 — Público (faixa etária padrão 25-45)', (await page.inputValue('#ai')) === '25-45' && await continuar.isDisabled());
  await page.fill('#ap', 'Casais que saem à noite');
  await page.fill('#al', 'São Paulo');
  await page.selectOption('#at', 'B2B');
  await continuar.click();
  check('wizard: passo 4 — Verba (exige total e diária)', await page.locator('#total').isVisible() && await continuar.isDisabled());
  await page.fill('#total', '3000');
  await page.fill('#daily', '100');
  await page.fill('#leads', '300');
  await page.fill('#ticket', '60');
  await continuar.click();
  const finalizar = page.getByRole('button', { name: /Gerar campanha com IA/ });
  check('wizard: passo 5 — Formatos (imagem estática e vídeo marcados)', tem(await corpo(), 'Imagem estática') && await finalizar.isEnabled());
  await page.getByRole('button', { name: 'Vídeo / Reels' }).click(); // desmarca
  await page.getByRole('button', { name: 'Vídeo / Reels' }).click(); // mrc de novo
  await page.getByRole('button', { name: 'Voltar' }).click();
  check('wizard: "Voltar" mantém os dados (passo 4)', (await page.inputValue('#total')) === '3000');
  await continuar.click();
  await finalizar.click();
  if (aiLive) {
    await page.getByText('Campanha criada com estratégia gerada pela IA.').waitFor({ timeout: 60000 });
    ok('wizard: toast "Campanha criada com estratégia gerada pela IA."');
  } else {
    await page.getByText(/Estratégia não gerada: IA do app não configurada/).waitFor({ timeout: 60000 });
    ok('wizard sem IA: toast "Estratégia não gerada: …" e segue para a campanha');
    esperado(/generate-campaign-strategy|generate-copy-with-ai|502|AI_NOT_CONFIGURED/);
  }
  await page.waitForURL(/\/campaigns\/[0-9a-f-]{36}$/, { timeout: 30000 });
  const campUrl = page.url();
  const campId = campUrl.split('/').pop();
  await page.getByRole('heading', { name: campNome }).waitFor({ timeout: 30000 });

  // detalhe
  check('detalhe: título da aba', (await page.title()) === 'Campanha · Meu Funil', await page.title());
  const txtDet = await corpo();
  check('detalhe: subtítulo marca · objetivo · período', tem(txtDet, `${marcaNome} · Vendas / Conversão · ${d1} → ${d2}`), txtDet.slice(-200));
  for (const t of ['Rascunho', 'Voltar', 'Solicitar aprovação', 'Verba total', 'Investido', 'Leads', 'ROAS', 'Estratégia', 'Copies', 'Criativos', 'Anúncios e regras', 'Briefing']) check(`detalhe mostra "${t}"`, tem(txtDet, t));
  check('detalhe: sem "Publicar na Meta" enquanto é rascunho', !tem(txtDet, 'Publicar na Meta'));
  check('detalhe: verba total e diária', tem(txtDet, 'R$') && tem(txtDet, '3.000,00') && tem(txtDet, '/dia'));

  if (aiLive) {
    check('estratégia v1 criada pelo wizard (descrição "Rascunho: revise e aprove…")', tem(await corpo(), 'Plano estratégico v1') && tem(await corpo(), 'Rascunho: revise e aprove para que os outros agentes sigam esta estratégia.'));
    const txtEst = await corpo();
    for (const t of ['Resumo executivo', 'Resumo v1', 'Objetivo SMART', 'Big idea v1', 'Ângulos criativos', 'Dobradinha', 'Gancho: "Dobrou o chopp"', 'Públicos para a Meta', 'Briefing para o designer', 'Roteiro de vídeo (15s)', 'Plano para o Instagram', 'Bastidores · 75%', 'Objeções e respostas', 'Canais e distribuição de verba', 'Meta: 100%', 'KPIs', 'CPL R$ 10', 'Hipóteses e plano de testes', 'Cronograma', 'Recomendações']) check(`estratégia mostra "${t}"`, tem(txtEst, t));
    // copy v1 (aba Copies)
    await page.getByRole('tab', { name: 'Copies' }).click();
    await page.getByText('Copies v1').waitFor({ timeout: 15000 });
    const txtCop = await corpo();
    for (const t of ['Headline principal', 'Headline v1', 'Variações de headline', 'Texto curto', 'Texto longo', 'Anúncio Meta', 'Instagram feed', 'Roteiro Reels', 'Stories', 'Script UGC', 'Script institucional', 'Carrossel', 'Quiz', 'Qual chopp?', 'Claro · Escuro · Misto', 'Criar design no Canva', 'Gerar variação']) check(`copy mostra "${t}"`, tem(txtCop, t));
    // a copy do wizard NÃO levou estratégia aprovada (ainda não existe aprovada, mas a v1 em rascunho já orienta)
    const pCopy1 = fakeAi.prompts.find((p) => p.name === 'copy')?.prompt ?? '';
    check('copy do wizard recebeu a estratégia (big idea no prompt)', pCopy1.includes('ESTRATÉGIA:') && pCopy1.includes('Big idea v1'), pCopy1.slice(-200));
    check('copy do wizard: marca e campanha no prompt', pCopy1.includes(`"name":"${marcaNome}"`) && pCopy1.includes('"offer_product":"Chopp artesanal"') && pCopy1.includes('"audience":{"persona":"Casais que saem à noite"'));

    // regerar estratégia -> v2; aprovar; plano do Instagram
    await page.getByRole('tab', { name: 'Estratégia' }).click();
    await page.getByRole('button', { name: 'Regerar com IA' }).click();
    await page.getByText('Estratégia v2 gerada pela IA. Revise e aprove para orientar copy e criativos.').waitFor({ timeout: 60000 });
    await page.getByText('Plano estratégico v2').waitFor({ timeout: 15000 });
    check('regerar: nova versão v2 em rascunho com a big idea nova', tem(await corpo(), 'Big idea v2') && !tem(await corpo(), 'Big idea v1'));
    await page.getByRole('button', { name: 'Aprovar estratégia' }).click();
    await page.getByText('Estratégia aprovada. Copy, criativos e vídeos passam a seguir esta versão.').waitFor({ timeout: 15000 });
    await page.getByText('Aprovada: copy, criativos, vídeos e públicos seguem esta versão.').waitFor({ timeout: 15000 });
    check('aprovada: some o botão "Aprovar estratégia"', (await page.getByRole('button', { name: 'Aprovar estratégia' }).count()) === 0);
    await page.getByRole('button', { name: 'Criar plano no Instagram' }).click();
    await page.getByText('Plano do Instagram criado em rascunho. Revise em Instagram → Estratégia.').waitFor({ timeout: 15000 });
    ok('plano do Instagram criado a partir da estratégia');

    // gerar variação de copy (v2) — agora a estratégia aprovada (v2) orienta
    await page.getByRole('tab', { name: 'Copies' }).click();
    await page.getByRole('button', { name: 'Gerar variação' }).click();
    await page.getByText('Novas copies geradas com IA do app.').waitFor({ timeout: 60000 });
    await page.getByText('Copies v2').waitFor({ timeout: 15000 });
    check('variação de copy: v2 com headline nova', tem(await corpo(), 'Headline v2'));
    const pCopy2 = [...fakeAi.prompts].reverse().find((p) => p.name === 'copy')?.prompt ?? '';
    check('variação: prompt traz "Versão 3" (seed = versão anterior + 1) e a estratégia aprovada (v2)', pCopy2.includes('Versão 3:') && pCopy2.includes('Big idea v2'), pCopy2.slice(-200));
  } else {
    check('sem IA: estratégia vazia', tem(await corpo(), 'Nenhuma estratégia gerada ainda.'));
    await page.getByRole('button', { name: 'Gerar com IA' }).click();
    await page.getByText('IA do app não configurada.').first().waitFor({ timeout: 30000 });
    ok('sem IA: "Gerar com IA" mostra a mensagem da API');
    esperado(/generate-campaign-strategy|502|AI_NOT_CONFIGURED/);
  }

  // abas restantes
  await page.getByRole('tab', { name: 'Criativos' }).click();
  await page.getByText('Nenhum criativo gerado para esta campanha.').waitFor({ timeout: 10000 });
  check('criativos: estado vazio + link do Creative Studio', await page.getByRole('link', { name: 'Abrir Creative Studio' }).count() === 1);
  await page.getByRole('tab', { name: 'Anúncios e regras' }).click();
  await page.getByText('Ainda sem resultados da Meta.').waitFor({ timeout: 10000 });
  check('anúncios: descrição sem sincronização', tem(await corpo(), 'Aparece depois que a campanha veicular na Meta. Atualiza sozinho a cada 3 horas.'));
  await page.getByRole('tab', { name: 'Briefing' }).click();
  const txtBr = await corpo();
  for (const t of ['Briefing original', 'Produto / oferta', 'Chopp artesanal · R$', '12,50', 'Promessa', 'O melhor chopp da cidade', 'https://exemplo.com.br', 'Meta de leads', 'Ticket médio', 'CAC máximo', 'Formatos', 'Imagem estática, Vídeo / Reels', 'persona: Casais que saem à noite', 'tipo: B2B']) check(`briefing mostra "${t}"`, tem(txtBr, t));

  // solicitar aprovação
  await page.getByRole('button', { name: 'Solicitar aprovação' }).click();
  await page.getByText('Aprovação solicitada. Confira em Aprovações.').waitFor({ timeout: 15000 });
  await page.getByText('Aguardando aprovação').first().waitFor({ timeout: 15000 });
  check('solicitar aprovação: status "Aguardando aprovação" e botão some', (await page.getByRole('button', { name: 'Solicitar aprovação' }).count()) === 0);

  // aprovações
  await page.goto(`${BASE}/approvals`);
  await page.getByRole('heading', { name: 'Aprovações' }).waitFor({ timeout: 30000 });
  check('aprovações: título da aba', (await page.title()) === 'Aprovações · Meu Funil', await page.title());
  const titulo = `Publicar campanha "${campNome}" na Meta`;
  await page.getByText(titulo).waitFor({ timeout: 15000 });
  const txtAp = await corpo();
  for (const t of ['Pendentes (', 'Instagram', 'Posts orgânicos aguardando aprovação', 'Decisões recentes', 'Audit log', 'Campanha', campNome, 'Verba diária de', 'objetivo Vendas / Conversão', 'Rejeitar', 'Aprovar', 'campaign.approval_requested', 'campaign.strategy_generated', 'campaign.created']) check(`aprovações mostra "${t}"`, tem(txtAp, t));
  check('aprovações: owner vê Aprovar/Rejeitar', (await page.getByRole('button', { name: 'Aprovar' }).count()) >= 1 && (await page.getByRole('button', { name: 'Rejeitar' }).count()) >= 1);
  const cartaoAp = page.locator('div.rounded-lg', { hasText: titulo }).last();
  await cartaoAp.getByRole('button', { name: 'Aprovar' }).click();
  await page.getByText('Aprovado. A ação foi liberada.').waitFor({ timeout: 15000 });
  await page.waitForFunction((t) => ![...document.querySelectorAll('div.rounded-lg')].some((d) => d.innerText.includes(t) && d.innerText.includes('Rejeitar')), titulo, { timeout: 15000 });
  const txtDec = await corpo();
  check('aprovação decidida: aparece em "Decisões recentes" como Aprovado', tem(txtDec, 'Decisões recentes') && tem(txtDec, titulo) && tem(txtDec, 'Aprovado'));
  check('audit log: approval.approved', tem(txtDec, 'approval.approved'));
  const apiCamp = (await apiCall('GET', `/v1/workspaces/${wsId}/campaigns/${campId}`)).body;
  check('campanha aprovada pelo pedido (status approved)', apiCamp.status === 'approved', apiCamp.status);

  // volta na campanha: aprovada -> "Publicar na Meta"
  await page.goto(campUrl);
  await page.getByRole('heading', { name: campNome }).waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: 'Publicar na Meta' }).waitFor({ timeout: 15000 });
  check('campanha aprovada: aparece "Publicar na Meta" e some "Solicitar aprovação"', (await page.getByRole('button', { name: 'Solicitar aprovação' }).count()) === 0 && tem(await corpo(), 'Aprovada'));

  // lista de campanhas com a linha
  await page.goto(`${BASE}/campaigns`);
  const linha = page.locator('tr', { hasText: campNome });
  await linha.waitFor({ timeout: 30000 });
  const txtLinha = await linha.innerText();
  check('lista: linha com marca, objetivo, período, verba, status', txtLinha.includes(marcaNome) && txtLinha.includes('Vendas / Conversão') && txtLinha.includes(d1) && txtLinha.includes('3.000,00') && txtLinha.includes('Aprovada') && txtLinha.includes('0,00x'), txtLinha);
  for (const t of ['Campanha', 'Objetivo', 'Período', 'Verba', 'Investido', 'Leads', 'ROAS', 'Status']) check(`lista: coluna "${t}"`, tem(await page.locator('thead').innerText(), t));
  await linha.getByRole('link', { name: campNome }).click();
  await page.waitForURL(campUrl, { timeout: 15000 });
  ok('lista: o nome leva ao detalhe');

  // rejeitar: segunda campanha
  const c2 = (await apiCall('POST', `/v1/workspaces/${wsId}/campaigns`, { brand_id: mrc.id, name: `${campNome} B`, objective: 'leads', audience: {}, formats: ['video'], budget_daily: 10 })).body;
  await apiCall('POST', `/v1/workspaces/${wsId}/campaigns/${c2.id}/request-approval`, {});
  await page.goto(`${BASE}/approvals`);
  const titulo2 = `Publicar campanha "${campNome} B" na Meta`;
  await page.getByText(titulo2).waitFor({ timeout: 15000 });
  await page.locator('div.rounded-lg', { hasText: titulo2 }).last().getByRole('button', { name: 'Rejeitar' }).click();
  await page.getByText('Rejeitado.').first().waitFor({ timeout: 15000 });
  await page.waitForFunction((t) => [...document.querySelectorAll('div')].some((d) => d.innerText.includes(t) && d.innerText.includes('Rejeitado')), titulo2, { timeout: 15000 });
  const apiCamp2 = (await apiCall('GET', `/v1/workspaces/${wsId}/campaigns/${c2.id}`)).body;
  check('pedido rejeitado: a campanha volta para rascunho', apiCamp2.status === 'draft', apiCamp2.status);
  check('audit log: approval.rejected', tem(await corpo(), 'approval.rejected'));
  // decidir de novo (API): pedido já decidido
  const reqs = (await apiCall('GET', `/v1/workspaces/${wsId}/approvals`)).body;
  const r2 = reqs.find((r) => r.title === titulo2);
  const again = await apiCall('POST', '/v1/approvals/decide-approval', { approvalId: r2.id, decision: 'approved' });
  check('decidir pedido já decidido → 409 "Este pedido já foi decidido."', again.status === 409 && again.body.error.message === 'Este pedido já foi decidido.');
  esperado(/\[http 409\]|409 \(Conflict\)/);

  // limpeza: a mrc leva campanhas/estratégias/cópias/pedidos (cascade); sobra só o plano do Instagram (mrc SetNull)
  await apiCall('DELETE', `/v1/workspaces/${wsId}/brands/${mrc.id}`);
  try {
    execSync(`docker exec meu-funil-postgres psql -U meufunil -d meufunil -qtc "DELETE FROM ig_content_plans WHERE name LIKE 'Instagram · Campanha Check %'"`, { stdio: 'ignore' });
  } catch { /* sem docker: o plano de teste fica (rascunho) */ }

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
gateway.close();
console.log(`\n${passou} ok, ${erros.length} falha(s)`);
if (erros.length) {
  for (const e of erros) console.log(`  - ${e}`);
  process.exit(1);
}
