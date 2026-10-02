import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { CanvaCallbackController, CanvaController } from './canva.controller';
import { CanvaService } from './canva.service';

@Module({ imports: [MediaModule], controllers: [CanvaController, CanvaCallbackController], providers: [CanvaService], exports: [CanvaService] })
export class CanvaModule {}
