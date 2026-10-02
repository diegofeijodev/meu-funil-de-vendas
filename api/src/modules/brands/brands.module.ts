import { Module } from '@nestjs/common';
import { BrandGuideService } from './brand-guide.service';
import { BrandsController } from './brands.controller';
import { BrandsService } from './brands.service';
import { CreativeGuideController } from './creative-guide.controller';

@Module({ controllers: [BrandsController, CreativeGuideController], providers: [BrandsService, BrandGuideService], exports: [BrandsService] })
export class BrandsModule {}
