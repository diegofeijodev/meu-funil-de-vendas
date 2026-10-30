import { Global, Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { StyleRefsService } from './style-refs.service';

/** Estilo das artes (Fatias 5/6). Global: o diretor de arte (criativos e Instagram) lê as notas por `StyleRefsService.loadStyleNotes`. */
@Global()
@Module({ imports: [MediaModule], providers: [StyleRefsService], exports: [StyleRefsService] })
export class StyleRefsModule {}
