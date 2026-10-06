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
