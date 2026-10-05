import { Module } from '@nestjs/common';
import { AssetsService } from './assets.service';
import { ENV } from '../../common/config/env.module';
import { Env } from '../../common/config/env.validation';
import { createGuardedFetch, EXTERNAL_FETCH } from './external-fetch';
import { ImageService } from './image.service';
import { LibraryService } from './library.service';
import { MediaActionsController, MediaResourceController } from './media.controller';
import { MediaQueryService } from './media-query.service';
import { testOverridesAllowed } from '../../common/config/test-overrides';

@Module({
  controllers: [MediaResourceController, MediaActionsController],
  providers: [
    // Única porta de rede do domínio de criativos/mídia/Canva/MCP — nos testes entra um fake.
    // Com guarda de conexão: o DNS é resolvido uma vez, endereços internos são recusados e a conexão é fixada no endereço verificado.
    { provide: EXTERNAL_FETCH, inject: [ENV], useFactory: (env: Env) => createGuardedFetch(testOverridesAllowed(env)) },
    ImageService,
    AssetsService,
    LibraryService,
    MediaQueryService,
  ],
  exports: [EXTERNAL_FETCH, ImageService, AssetsService],
})
export class MediaModule {}
