import { Module } from '@nestjs/common';
import { AssetsService } from './assets.service';
import { EXTERNAL_FETCH, ExternalFetch } from './external-fetch';
import { ImageService } from './image.service';
import { LibraryService } from './library.service';
import { MediaActionsController, MediaResourceController } from './media.controller';
import { MediaQueryService } from './media-query.service';

@Module({
  controllers: [MediaResourceController, MediaActionsController],
  providers: [
    // Única porta de rede do domínio de criativos/mídia/Canva/MCP — nos testes entra um fake.
    { provide: EXTERNAL_FETCH, useValue: ((url, init) => fetch(url, init)) as ExternalFetch },
    ImageService,
    AssetsService,
    LibraryService,
    MediaQueryService,
  ],
  exports: [EXTERNAL_FETCH, ImageService, AssetsService],
})
export class MediaModule {}
