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
