jest.setTimeout(60_000);

import { WS_A } from '../../media/__tests__/mem';
import { PipelineService } from '../pipeline.service';
import { RefsService } from '../refs.service';
import { ART, creativeWorld } from './world';

describe('PipelineService — avisos do provedor', () => {
  it('o aviso do gateway sem referência volta em notes, uma vez só (vai para o log de geração do post)', async () => {
    const w = await creativeWorld();
    try {
      const note = 'Gateway sem suporte a referência; gerado sem foto da marca.';
      w.provider.image.mockImplementation(async () => ({ status: 'ready', assetUrl: null, bytes: w.png, mime: 'image/png', thumbnailUrl: null, externalJobId: null, cost: 1, note }));
      const pipeline = new PipelineService(w.prisma, w.ai as any, w.assets, w.images, new RefsService(w.prisma, w.files, w.assets, w.images));
      const res = await pipeline.run({ workspaceId: WS_A, brand: null, provider: w.provider, ad: ART as any, aspectRatio: '1:1', targetFormat: 'ig_feed_square', refs: [], variations: 2, layout: 'limpo', text: {}, title: 'Teste' });
      expect(res.pending).toBeNull();
      if (res.pending === null) expect(res.notes).toEqual([note]);
    } finally {
      w.cleanup();
    }
  });
});
