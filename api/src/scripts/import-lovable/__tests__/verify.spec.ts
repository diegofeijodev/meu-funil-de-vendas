import { verdict, VerifyFindings } from '../verify';

const clean = (): VerifyFindings => ({ countMismatches: [], orphans: [], missingFiles: [], remainingLinks: [], unreadableCredentials: 0, overduePending: 0 });

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

  it('publicação ou post vencido ainda pendente reprova (sairia sozinho ao subir a API)', () => {
    const f = clean();
    f.overduePending = 3;
    expect(verdict(f)).toEqual({ ok: false, lines: ['publicações/posts vencidos ainda pendentes: 3', 'verificação: PENDÊNCIAS'] });
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
