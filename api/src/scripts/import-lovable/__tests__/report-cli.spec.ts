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
