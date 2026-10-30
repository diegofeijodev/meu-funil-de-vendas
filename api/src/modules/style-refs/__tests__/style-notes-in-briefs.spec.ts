import { buildVisualPrompt } from '../../creative/art-director';
import { DEFAULT_VIDEO_AUDIO, videoDirectorPrompt } from '../../creative/video-director';
import { styleNotesText } from '../style-notes';

const NOTES = styleNotesText([{ paleta: ['laranja'], composicao: 'centro', luz: 'quente', enquadramento: 'perto', clima: 'aconchegante', evitar: [] }])!;

describe('notas de estilo chegam ao diretor de arte e ao de vídeo — só texto', () => {
  it('buildVisualPrompt põe a inspiração quando há notas e não põe sem notas; nenhuma imagem é anexada', async () => {
    const reqs: any[] = [];
    const ai: any = { json: async (_ws: string, req: any) => { reqs.push(req); return { prompt_final: 'cena', text_in_image: 'none' }; } };
    const base = { workspaceId: 'w', brand: null, aspectRatio: '1:1', kind: 'image' as const, provider: 'p' };
    await buildVisualPrompt(ai, { ...base, styleNotes: NOTES }).catch(() => undefined);
    await buildVisualPrompt(ai, base).catch(() => undefined);
    expect(reqs[0].prompt).toContain(NOTES);
    expect(reqs[0].images ?? []).toHaveLength(0);
    expect(reqs[1].prompt).not.toContain('INSPIRAÇÃO DE ESTILO');
  });

  it('videoDirectorPrompt põe a inspiração quando há notas', () => {
    const b: any = { workspaceId: 'w', brand: null, context: null, format: 'reel', theme: 't', hook: null, cta: null, userPrompt: null, audio: DEFAULT_VIDEO_AUDIO, hasFirstFrame: false, provider: 'p' };
    expect(videoDirectorPrompt({ ...b, styleNotes: NOTES })).toContain(NOTES);
    expect(videoDirectorPrompt(b)).not.toContain('INSPIRAÇÃO DE ESTILO');
  });
});
