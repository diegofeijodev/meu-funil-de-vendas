import { Global, Module } from '@nestjs/common';
import { AiKeysService } from './ai-keys.service';
import { AiService } from './ai.service';
import { AI_FETCH, AiFetch } from './ai.types';

@Global()
@Module({
  providers: [
    // Única porta de rede da IA — nos testes entra um fake.
    { provide: AI_FETCH, useValue: ((url, init) => fetch(url, init)) as AiFetch },
    AiKeysService,
    AiService,
  ],
  exports: [AiService, AiKeysService, AI_FETCH],
})
export class AiModule {}
