import { Global, Module } from '@nestjs/common';
import { CredentialStore, PrismaCredentialStore } from './credential-store';
import { VaultService } from './vault.service';

@Global()
@Module({
  providers: [{ provide: CredentialStore, useClass: PrismaCredentialStore }, VaultService],
  exports: [VaultService],
})
export class VaultModule {}
