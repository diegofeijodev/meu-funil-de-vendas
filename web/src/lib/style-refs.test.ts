import { describe, expect, it } from 'vitest';
import {
  BRAND_PHOTOS_TEXT,
  brandCounter,
  brandPhotosToast,
  liveAnnouncement,
  packageInvite,
  styleInvite,
  INVITE_CTA,
  photoLabel,
  refOrigin,
  refScope,
  refStateText,
  removedToast,
  removeLabel,
  seeAllLabel,
  stopSourceQuestion,
  visibleRefs,
  type StyleRefLike,
} from './style-refs';

const r = (o: Partial<StyleRefLike> = {}): StyleRefLike => ({ source: 'upload', from_source: false, source_title: null, campaign_id: null, campaign_name: null, status: 'ready', attempts: 0, summary: 'cores laranja; luz quente', ...o });

describe('style-refs', () => {
  it('origem e onde vale', () => {
    expect(refOrigin(r())).toBe('Imagem enviada');
    expect(refOrigin(r({ source: 'pinterest' }))).toBe('Pin do Pinterest');
    expect(refOrigin(r({ source: 'pinterest', from_source: true, source_title: 'Bares escuros' }))).toBe('Pasta Bares escuros');
    expect(refOrigin(r({ source: 'pinterest', from_source: true }))).toBe('Pasta do Pinterest');
    expect(refScope(r())).toBe('vale para toda a marca');
    expect(refScope(r({ campaign_id: 'c', campaign_name: 'Jundiaí' }))).toBe('só na campanha Jundiaí');
  });
  it('estados', () => {
    expect(refStateText(r({ status: 'processing' }))).toBe('Lendo o estilo…');
    expect(refStateText(r({ status: 'processing', attempts: 1 }))).toBe('Não deu para ler agora. Tentando de novo sozinho (2 de 3).');
    expect(refStateText(r())).toBe('Em uso. O que eu peguei: cores laranja; luz quente');
    expect(refStateText(r({ summary: null }))).toBe('Em uso. O que eu peguei: estilo lido.');
    expect(refStateText(r({ status: 'failed' }))).toBe('Não conseguimos ler esta imagem. Remova e tente outra.');
  });
  it('contador, parar, remover, lista de 4', () => {
    expect(brandCounter(12)).toBe('12 de 30 referências nesta marca. Quando enche, as mais antigas das pastas dão lugar às novas.');
    expect(stopSourceQuestion(5)).toBe('Parar de acompanhar esta pasta? As 5 referências que vieram dela saem da marca.');
    expect(removedToast({ from_source: true })).toBe('Referência removida. Ela não volta, mesmo continuando na pasta.');
    expect(removedToast({ from_source: false })).toBe('Referência removida.');
    expect(removeLabel(r({ source: 'pinterest' }))).toBe('Remover referência: Pin do Pinterest');
    expect(visibleRefs([1, 2, 3, 4, 5, 6], false)).toEqual([1, 2, 3, 4]);
    expect(visibleRefs([1, 2, 3, 4, 5, 6], true)).toHaveLength(6);
    expect(seeAllLabel(38)).toBe('Ver todas (38)');
  });
  it('região viva: anuncia leitura nova, pronta e falha (uma frase por vez)', () => {
    expect(liveAnnouncement(undefined, [{ id: 'a', status: 'processing' }])).toBeNull();
    expect(liveAnnouncement([], [{ id: 'a', status: 'processing' }])).toBe('Lendo o estilo…');
    expect(liveAnnouncement([{ id: 'a', status: 'processing' }], [{ id: 'a', status: 'ready' }])).toBe('Referência pronta. O estilo já está em uso.');
    expect(liveAnnouncement([{ id: 'a', status: 'processing' }], [{ id: 'a', status: 'failed' }])).toBe('Não conseguimos ler uma referência.');
    // prioridade: falha > pronta > lendo
    expect(
      liveAnnouncement(
        [{ id: 'a', status: 'processing' }, { id: 'b', status: 'processing' }],
        [{ id: 'a', status: 'ready' }, { id: 'b', status: 'failed' }, { id: 'c', status: 'processing' }],
      ),
    ).toBe('Não conseguimos ler uma referência.');
    expect(
      liveAnnouncement([{ id: 'a', status: 'processing' }], [{ id: 'a', status: 'ready' }, { id: 'c', status: 'processing' }]),
    ).toBe('Referência pronta. O estilo já está em uso.');
  });

  it('fotos da marca: rótulo da grade e aviso de envio', () => {
    expect(photoLabel('Produto')).toBe('Foto de: Produto');
    expect(photoLabel(null)).toBe('Foto da sua marca');
    expect(brandPhotosToast(1)).toBe('Foto enviada. Ela pode aparecer nas artes.');
    expect(brandPhotosToast(3)).toBe('3 fotos enviadas. Elas podem aparecer nas artes.');
    expect(BRAND_PHOTOS_TEXT.option('Ambiente')).toBe('Foto de: Ambiente');
  });
  it('convite onde a arte é vista', () => {
    expect(styleInvite(null)).toBeNull(); // peça antiga / prompt escrito à mão
    expect(styleInvite(undefined)).toBeNull();
    expect(styleInvite({ own: [], library: [], brand_id: 'b1' })).toEqual({ text: 'Estilo: sem referências.', cta: true, brandId: 'b1' });
    expect(styleInvite({ own: ['a'], library: [], brand_id: 'b1' })).toEqual({ text: 'Estilo: seguiu 1 referência sua.', cta: false, brandId: 'b1' });
    expect(styleInvite({ own: ['a', 'b', 'c'], library: [], brand_id: null })?.text).toBe('Estilo: seguiu 3 referências suas.');
    expect(packageInvite([null, { own: ['a'], library: [], brand_id: 'b' }, { own: ['a', 'b'], library: [], brand_id: 'b' }])?.text).toBe('Estilo: seguiu 2 referências suas.');
    expect(packageInvite([undefined, null])).toBeNull();
    expect(INVITE_CTA).toBe('Mostrar o estilo que eu quero');
  });
});
