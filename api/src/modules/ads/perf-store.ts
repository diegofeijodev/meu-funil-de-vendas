import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/database/prisma.service';

export type PerfRow = {
  workspace_id: string;
  campaign_id: string;
  creative_id?: string | null;
  adset_name?: string | null;
  ad_name?: string | null;
  date: string;
  spend: number;
  impressions: number;
  reach?: number;
  clicks: number;
  leads: number;
  conversions: number;
  revenue: number;
  source: 'meta' | 'google' | 'tiktok';
  meta_ad_id?: string | null;
  meta_adset_id?: string | null;
  external_id?: string | null;
};

const BATCH = 500;
const int = (n: number) => Math.max(0, Math.round(Number.isFinite(n) ? n : 0));
const money = (n: number) => (Number.isFinite(n) ? n : 0);

/**
 * `performance_daily` em lote (`upsert` do protótipo, 500 por vez). SQL cru porque o Prisma não faz upsert em índice único com
 * coluna anulável (`meta_ad_id`/`external_id`) nem em lote. Todo valor vai como parâmetro (nada interpolado).
 */
@Injectable()
export class PerfStore {
  constructor(private readonly prisma: PrismaService) {}

  /** Conflito `(campaign_id, meta_ad_id, date)` — linhas da Meta. */
  async upsertMeta(rows: PerfRow[], syncedAt: Date): Promise<number> {
    return this.upsert(rows, syncedAt, 'meta');
  }

  /** Conflito `(campaign_id, source, external_id, date)` — Google/TikTok. */
  async upsertExternal(rows: PerfRow[], syncedAt: Date): Promise<number> {
    return this.upsert(rows, syncedAt, 'external');
  }

  private async upsert(all: PerfRow[], syncedAt: Date, kind: 'meta' | 'external'): Promise<number> {
    // Duas linhas com a mesma chave no mesmo comando derrubam o ON CONFLICT: a última vence.
    const byKey = new Map<string, PerfRow>();
    for (const r of all) byKey.set(kind === 'meta' ? `${r.campaign_id}|${r.meta_ad_id}|${r.date}` : `${r.campaign_id}|${r.source}|${r.external_id}|${r.date}`, r);
    const rows = [...byKey.values()];
    for (let i = 0; i < rows.length; i += BATCH) {
      const values = rows.slice(i, i + BATCH).map(
        (r) => Prisma.sql`(gen_random_uuid(), ${r.workspace_id}::uuid, ${r.campaign_id}::uuid, ${r.creative_id ?? null}::uuid, ${r.adset_name ?? null}, ${r.ad_name ?? null}, ${r.date}::date,
          ${money(r.spend)}::numeric, ${int(r.impressions)}::bigint, ${int(r.reach ?? 0)}::bigint, ${int(r.clicks)}::bigint, ${int(r.leads)}::bigint, ${int(r.conversions)}::bigint, ${money(r.revenue)}::numeric,
          ${r.source}, ${r.meta_ad_id ?? null}, ${r.meta_adset_id ?? null}, ${r.external_id ?? null}, ${syncedAt}::timestamptz)`,
      );
      const conflict = kind === 'meta' ? Prisma.sql`(campaign_id, meta_ad_id, date)` : Prisma.sql`(campaign_id, source, external_id, date)`;
      await this.prisma.$executeRaw`
        INSERT INTO performance_daily (id, workspace_id, campaign_id, creative_id, adset_name, ad_name, date, spend, impressions, reach, clicks, leads, conversions, revenue, source, meta_ad_id, meta_adset_id, external_id, synced_at)
        VALUES ${Prisma.join(values)}
        ON CONFLICT ${conflict} DO UPDATE SET
          workspace_id = EXCLUDED.workspace_id, creative_id = EXCLUDED.creative_id, adset_name = EXCLUDED.adset_name, ad_name = EXCLUDED.ad_name,
          spend = EXCLUDED.spend, impressions = EXCLUDED.impressions, reach = EXCLUDED.reach, clicks = EXCLUDED.clicks, leads = EXCLUDED.leads,
          conversions = EXCLUDED.conversions, revenue = EXCLUDED.revenue, source = EXCLUDED.source, meta_adset_id = EXCLUDED.meta_adset_id, synced_at = EXCLUDED.synced_at`;
    }
    return rows.length;
  }
}
