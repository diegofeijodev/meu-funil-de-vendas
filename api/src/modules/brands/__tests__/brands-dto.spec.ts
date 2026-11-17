import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateBrandDto } from '../dto/brands.dto';

const errs = async (o: object) => (await validate(plainToInstance(UpdateBrandDto, o))).map((e) => e.property);

describe('UpdateBrandDto — Seleção do Meu Funil', () => {
  it('ramo: id de categoria e "none" passam; lixo é recusado; null volta ao automático', async () => {
    expect(await errs({ style_library_segment: 'acai_sorvete' })).toEqual([]);
    expect(await errs({ style_library_segment: 'none' })).toEqual([]);
    expect(await errs({ style_library_segment: null })).toEqual([]);
    expect(await errs({ style_library_segment: 'xyz' })).toEqual(['style_library_segment']);
  });
  it('interruptor: boolean passa, ausente passa, null é recusado (coluna NOT NULL)', async () => {
    expect(await errs({ style_library_enabled: false })).toEqual([]);
    expect(await errs({})).toEqual([]);
    expect(await errs({ style_library_enabled: null })).toEqual(['style_library_enabled']);
    expect(await errs({ style_library_enabled: 'sim' })).toEqual(['style_library_enabled']);
  });
});
