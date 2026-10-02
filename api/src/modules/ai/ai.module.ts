import { Global, Module } from '@nestjs/common';
import { AiKeysService } from './ai-keys.service';
import { AiService } from './ai.service';
import { ENV } from '../../common/config/env.module';
import { Env } from '../../common/config/env.validation';
import { createGuardedFetch } from '../media/external-fetch';
import { AI_FETCH, AI_GUARDED_FETCH, AiFetch } from './ai.types';

@Global()
@Module({
  providers: [
    // Única porta de rede da IA — nos testes entra um fake.
    { provide: AI_FETCH, useValue: ((url, init) => fetch(url, init)) as AiFetch },
    { provide: AI_GUARDED_FETCH, inject: [ENV], useFactory: (env: Env) => createGuardedFetch(env.NODE_ENV !== 'production') },
    AiKeysService,
    AiService,
  ],
  exports: [AiService, AiKeysService, AI_FETCH],
})
export class AiModule {}
