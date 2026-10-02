import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ParseUuidPipe } from '../../common/ids/uuid';
import { WorkspaceAccessGuard } from '../access/workspace-access.guard';
import { BrandsService } from './brands.service';
import {
  CreateBrandAssetDto, CreateBrandDto, CreatePersonaDto, CreateProductDto, UpdateBrandDto, UpdatePersonaDto, UpdateProductDto,
} from './dto/brands.dto';

/** GET = read, o resto = write (viewer só lê). Rotas estáticas antes das `:id`. */
@ApiTags('Brands')
@ApiBearerAuth()
@UseGuards(WorkspaceAccessGuard)
@Controller('v1/workspaces/:workspaceId/brands')
export class BrandsController {
  constructor(private readonly brands: BrandsService) {}

  @Get()
  list(@Param('workspaceId', ParseUuidPipe) ws: string) {
    return this.brands.list(ws);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Param('workspaceId', ParseUuidPipe) ws: string, @Body() dto: CreateBrandDto) {
    return this.brands.create(user.id, ws, dto);
  }

  @Get(':brandId')
  get(@Param('workspaceId', ParseUuidPipe) ws: string, @Param('brandId', ParseUuidPipe) id: string) {
    return this.brands.get(ws, id);
  }

  @Patch(':brandId')
  update(@CurrentUser() user: AuthUser, @Param('workspaceId', ParseUuidPipe) ws: string, @Param('brandId', ParseUuidPipe) id: string, @Body() dto: UpdateBrandDto) {
    return this.brands.update(user.id, ws, id, dto);
  }

  @Delete(':brandId')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param('workspaceId', ParseUuidPipe) ws: string, @Param('brandId', ParseUuidPipe) id: string) {
    return this.brands.remove(user.id, ws, id);
  }

  // ---- produtos
  @Get(':brandId/products')
  products(@Param('workspaceId', ParseUuidPipe) ws: string, @Param('brandId', ParseUuidPipe) id: string) {
    return this.brands.listProducts(ws, id);
  }

  @Post(':brandId/products')
  addProduct(@Param('workspaceId', ParseUuidPipe) ws: string, @Param('brandId', ParseUuidPipe) id: string, @Body() dto: CreateProductDto) {
    return this.brands.createProduct(ws, id, dto);
  }

  @Patch(':brandId/products/:id')
  editProduct(
    @Param('workspaceId', ParseUuidPipe) ws: string, @Param('brandId', ParseUuidPipe) brandId: string,
    @Param('id', ParseUuidPipe) id: string, @Body() dto: UpdateProductDto,
  ) {
    return this.brands.updateProduct(ws, brandId, id, dto);
  }

  @Delete(':brandId/products/:id')
  @HttpCode(204)
  deleteProduct(@Param('workspaceId', ParseUuidPipe) ws: string, @Param('brandId', ParseUuidPipe) brandId: string, @Param('id', ParseUuidPipe) id: string) {
    return this.brands.removeProduct(ws, brandId, id);
  }

  // ---- personas
  @Get(':brandId/personas')
  personas(@Param('workspaceId', ParseUuidPipe) ws: string, @Param('brandId', ParseUuidPipe) id: string) {
    return this.brands.listPersonas(ws, id);
  }

  @Post(':brandId/personas')
  addPersona(@Param('workspaceId', ParseUuidPipe) ws: string, @Param('brandId', ParseUuidPipe) id: string, @Body() dto: CreatePersonaDto) {
    return this.brands.createPersona(ws, id, dto);
  }

  @Patch(':brandId/personas/:id')
  editPersona(
    @Param('workspaceId', ParseUuidPipe) ws: string, @Param('brandId', ParseUuidPipe) brandId: string,
    @Param('id', ParseUuidPipe) id: string, @Body() dto: UpdatePersonaDto,
  ) {
    return this.brands.updatePersona(ws, brandId, id, dto);
  }

  @Delete(':brandId/personas/:id')
  @HttpCode(204)
  deletePersona(@Param('workspaceId', ParseUuidPipe) ws: string, @Param('brandId', ParseUuidPipe) brandId: string, @Param('id', ParseUuidPipe) id: string) {
    return this.brands.removePersona(ws, brandId, id);
  }

  // ---- aprendizados (somente leitura)
  @Get(':brandId/learnings')
  learnings(@Param('workspaceId', ParseUuidPipe) ws: string, @Param('brandId', ParseUuidPipe) id: string) {
    return this.brands.listLearnings(ws, id);
  }

  // ---- arquivos da marca
  @Get(':brandId/assets')
  assets(@Param('workspaceId', ParseUuidPipe) ws: string, @Param('brandId', ParseUuidPipe) id: string) {
    return this.brands.listAssets(ws, id);
  }

  @Post(':brandId/assets')
  addAsset(@Param('workspaceId', ParseUuidPipe) ws: string, @Param('brandId', ParseUuidPipe) id: string, @Body() dto: CreateBrandAssetDto) {
    return this.brands.createAsset(ws, id, dto);
  }

  @Delete(':brandId/assets/:id')
  @HttpCode(204)
  deleteAsset(@Param('workspaceId', ParseUuidPipe) ws: string, @Param('brandId', ParseUuidPipe) brandId: string, @Param('id', ParseUuidPipe) id: string) {
    return this.brands.removeAsset(ws, brandId, id);
  }
}
