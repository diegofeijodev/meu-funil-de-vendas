/**
 * Ids de job de vídeo assíncrono: `veo:<id do gateway>` e `gveo:<nome da operação Gemini>`
 * (`models/<modelo>/operations/<id>` ou `operations/<id>`).
 * Só estes formatos chegam ao provedor — o id vai parar numa URL (`/videos/<id>`, `/<operation.name>`),
 * então um valor arbitrário vindo de fora seria um desvio de caminho. Cada segmento começa com letra/número
 * (nada de `.`/`..`) e não há `?`, `#`, `\` nem `%`.
 */
const SEG = '[A-Za-z0-9][A-Za-z0-9._-]{0,199}';
const VEO = new RegExp(`^veo:${SEG}$`);
const GVEO = new RegExp(`^gveo:(models/${SEG}/)?operations/${SEG}$`);

export const isValidVideoJobId = (id: unknown): id is string => typeof id === 'string' && id.length < 600 && (VEO.test(id) || GVEO.test(id));
