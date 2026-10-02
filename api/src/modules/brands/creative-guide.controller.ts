import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { BrandGuideService } from './brand-guide.service';
import { GenerateBrandGuideDto } from './dto/brands.dto';

/** Ação `generateBrandGuide` (server fn de `creative.functions.ts`): `POST /v1/creative/generate-brand-guide`. */
@ApiTags('Brands')
@ApiBearerAuth()
@Controller('v1/creative')
export class CreativeGuideController {
  constructor(private readonly guide: BrandGuideService) {}

  @Post('generate-brand-guide')
  @HttpCode(200)
  generate(@CurrentUser() user: AuthUser, @Body() dto: GenerateBrandGuideDto) {
    return this.guide.generate(user.id, dto.brandId);
  }
}
