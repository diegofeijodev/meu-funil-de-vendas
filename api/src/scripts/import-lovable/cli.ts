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
