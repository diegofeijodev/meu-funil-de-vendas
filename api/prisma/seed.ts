// Seed de desenvolvimento: usuário demo + workspace demo (owner). Idempotente.
//   demo@meufunil.local / meufunil123
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import 'reflect-metadata';
import { provisionUser } from '../src/modules/auth/provision-user';

const EMAIL = 'demo@meufunil.local';
const PASSWORD = 'meufunil123';

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('seed de desenvolvimento: recusado com NODE_ENV=production.');
  const prisma = new PrismaClient();
  try {
    const existing = await prisma.users.findUnique({ where: { email: EMAIL } });
    if (existing) {
      console.log(`seed: ${EMAIL} já existe (id ${existing.id}).`);
      return;
    }
    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    const { user, workspace } = await prisma.$transaction((tx) =>
      provisionUser(tx, { email: EMAIL, passwordHash, fullName: 'Demo', companyName: 'Meu Funil Demo' }),
    );
    console.log(`seed: usuário ${user.email} (${user.id}) · workspace "${workspace.name}" (${workspace.id}) · senha ${PASSWORD}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
