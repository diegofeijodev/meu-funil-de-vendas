import { Global, Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { StyleRefsService } from './style-refs.service';
import { StyleRefsController } from './style-refs.controller';
import { StyleRefsCronService } from './style-refs-cron.service';

/** Estilo das artes (Fatias 5/6). Global: o diretor de arte (criativos e Instagram) lê as notas por `StyleRefsService.loadStyleNotes`. */
@Global()
@Module({ imports: [MediaModule], controllers: [StyleRefsController], providers: [StyleRefsService, StyleRefsCronService], exports: [StyleRefsService] })
export class StyleRefsModule {}
