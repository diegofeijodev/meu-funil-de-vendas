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
