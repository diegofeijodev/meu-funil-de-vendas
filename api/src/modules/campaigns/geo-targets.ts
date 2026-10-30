/**
 * Região da campanha como dado (Fatia 2, spec §2.2): lista de cidades da Meta com raio. Antes era só o texto `audience.localizacao`,
 * que caía em "Brasil inteiro" quando a Meta não reconhecia. Raio de cidade na Meta: 17 a 80 km; `null` = só a cidade.
 */
import { BadRequestException } from '@nestjs/common';

export type GeoTarget = { type: 'city'; name: string; uf: string | null; meta_key: string | null; radius_km: number | null };

export const MIN_RADIUS_KM = 17;
export const MAX_RADIUS_KM = 80;
const MAX_TARGETS = 10;

const bad = (message: string) => new BadRequestException({ code: 'BAD_REQUEST', message });

export function parseGeoTargets(raw: unknown): GeoTarget[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw bad('Região inválida.');
  if (raw.length > MAX_TARGETS) throw bad('No máximo 10 cidades por campanha.');
  return raw.map((item) => {
    const r = (item ?? {}) as Record<string, unknown>;
    const name = typeof r['name'] === 'string' ? r['name'].trim().slice(0, 120) : '';
    if (!name) throw bad('Informe a cidade (ex.: Jundiaí, SP).');
    const ufRaw = typeof r['uf'] === 'string' ? r['uf'].trim().toUpperCase() : '';
    const uf = /^[A-Z]{2}$/.test(ufRaw) ? ufRaw : null;
    const key = r['meta_key'] == null || r['meta_key'] === '' ? null : String(r['meta_key']);
    if (key !== null && !/^\d{1,20}$/.test(key)) throw bad('Cidade inválida. Escolha de novo na lista.');
    const radius = r['radius_km'] == null ? null : Number(r['radius_km']);
    if (radius !== null && (!Number.isInteger(radius) || radius < MIN_RADIUS_KM || radius > MAX_RADIUS_KM)) {
      throw bad('A Meta aceita de 17 a 80 km em volta de uma cidade.');
    }
    return { type: 'city' as const, name, uf, meta_key: key, radius_km: radius };
  });
}

/** Lista gravada na campanha (coluna jsonb) → itens; dado antigo/estranho vira lista vazia (caminho de texto da Fatia 0). */
export function readGeoTargets(raw: unknown): GeoTarget[] {
  try {
    return parseGeoTargets(raw);
  } catch {
    return [];
  }
}

/** "Jundiaí – SP (+20 km), Campinas – SP (só a cidade)". */
export function geoLabel(targets: GeoTarget[]): string {
  return targets
    .map((t) => `${t.name}${t.uf ? ` – ${t.uf}` : ''} (${t.radius_km ? `+${t.radius_km} km` : 'só a cidade'})`)
    .join(', ');
}

/** Texto legível para `audience.localizacao` ("Jundiaí, SP; Campinas, SP"), mantido junto com a lista. */
export const geoText = (targets: GeoTarget[]) => targets.map((t) => (t.uf ? `${t.name}, ${t.uf}` : t.name)).join('; ');
