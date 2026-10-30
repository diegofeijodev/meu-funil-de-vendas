/**
 * `POST /v1/workspaces/:ws/campaigns/intake` (Fatia 1): o dono conta o que quer em texto e recebe o "Entendi" — rascunho da campanha,
 * até 3 perguntas e as suposições. Nada é gravado: o "Criar" usa o `POST …/campaigns` de sempre. Gasta IA, então pede `write`.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';
import { todaySp } from '../../common/time/dates';
import { WorkspaceAccessService } from '../access/access.service';
import { AiService } from '../ai/ai.service';
import { FeaturesService } from '../workspaces/features.service';
import { buildIntake, INTAKE_SCHEMA, IntakeAi, IntakeResult } from './campaign-intake';
import { OBJECTIVES } from './campaign-labels';

@Injectable()
export class CampaignIntakeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly ai: AiService,
    private readonly features: FeaturesService,
  ) {}

  async intake(userId: string, workspaceId: string, dto: { brand_id: string; text: string }): Promise<IntakeResult> {
    // Fora da lista a função não existe (a tela abre o formulário de hoje).
    if (!this.features.intakeEnabled(workspaceId)) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Não encontrado.' });
    await this.access.require(userId, workspaceId, 'write');
    const text = (dto.text ?? '').trim();
    if (!text) throw new BadRequestException({ code: 'BAD_REQUEST', message: 'Conte em uma ou duas frases o que você quer.' });
    const brand = await this.prisma.brands.findFirst({ where: { id: dto.brand_id, workspace_id: workspaceId } });
    if (!brand) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Marca não encontrada.' });

    const recent = await this.prisma.campaigns.findMany({
      where: { workspace_id: workspaceId },
      select: { landing_url: true },
      orderBy: { created_at: 'desc' },
      take: 20,
    });
    const lastLanding = recent.find((c) => c.landing_url)?.landing_url ?? null;

    const today = todaySp();
    const b = brand as Record<string, unknown>;
    const prompt = [
      'Você é o estrategista de marketing de uma agência no Brasil. Leia o PEDIDO do dono e preencha o JSON da campanha.',
      'Regras:',
      '- Não invente números nem links: verba, metas e destino só se estiverem escritos no pedido; senão devolva 0 (números) ou "" (textos).',
      '- Período: "inicio" = hoje | amanha | data. "duracao_dias" quando o pedido disser quantos dias/semanas/meses (1 mês = 30 dias).',
      '  Só preencha inicio_data/fim_data (AAAA-MM-DD) se o pedido trouxer uma data de calendário; use HOJE para saber o ano.',
      `- objetivo: uma de ${JSON.stringify(Object.keys(OBJECTIVES))} (cadastros/contatos = leads; vendas = sales; conversas no WhatsApp = whatsapp; visitas ao site = traffic).`,
      '- publico.tipo = B2B quando quem compra é empresa; localizacao = cidade e UF como no endereço (ex.: "Jundiaí, SP").',
      '- promessa = a oferta com as palavras do dono (ex.: "Primeira contratação grátis"); vazio se não houver oferta.',
      '- resumo_objetivo: frase curta começando com verbo no infinitivo (ex.: "trazer cadastros de bares e restaurantes de Jundiaí").',
      '- suposicoes: até 4 coisas que você considerou sem estarem escritas (ex.: para quem é a campanha), em português simples.',
      `HOJE: ${today}`,
      `MARCA: ${JSON.stringify({ nome: b['name'], segmento: b['segment'], regiao: b['region'], publico: b['target_audience'] })}`,
      `PEDIDO: ${JSON.stringify(text)}`,
    ].join('\n');

    const out = await this.ai.json<IntakeAi>(workspaceId, { prompt, schema: INTAKE_SCHEMA as unknown as Record<string, unknown>, name: 'campaign_intake' });
    return buildIntake(out ?? {}, text, today, lastLanding);
  }
}
