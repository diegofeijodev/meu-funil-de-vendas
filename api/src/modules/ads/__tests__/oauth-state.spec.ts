import { adsWorld, OWNER, WS_A } from './harness';
import { MSG_STATE_EXPIRED, MSG_STATE_INVALID, OAuthStateService } from '../oauth-state.service';

describe('OAuthStateService', () => {
  it('emite state aleatório, guarda só o hash e consome uma única vez', async () => {
    const w = adsWorld();
    const s = new OAuthStateService(w.prisma);
    const a = await s.issue('meta', WS_A, OWNER);
    const b = await s.issue('meta', WS_A, OWNER);
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(40);
    expect(w.t['oauth_states']!.rows.map((r) => r.state_hash)).not.toContain(a);
    expect(await s.consume('meta', a)).toEqual({ workspaceId: WS_A, userId: OWNER });
    await expect(s.consume('meta', a)).rejects.toThrow(MSG_STATE_INVALID);
  });

  it('recusa canal diferente, desconhecido, malformado e vencido (e o vencido também é consumido)', async () => {
    const w = adsWorld();
    const s = new OAuthStateService(w.prisma);
    const g = await s.issue('google', WS_A, OWNER);
    await expect(s.consume('tiktok', g)).rejects.toThrow(MSG_STATE_INVALID);
    await expect(s.consume('meta', 'x')).rejects.toThrow(MSG_STATE_INVALID);
    await expect(s.consume('google', 'a'.repeat(43))).rejects.toThrow(MSG_STATE_INVALID);
    w.t['oauth_states']!.rows[0]!.expires_at = new Date(Date.now() - 1000);
    await expect(s.consume('google', g)).rejects.toThrow(MSG_STATE_EXPIRED);
    await expect(s.consume('google', g)).rejects.toThrow(MSG_STATE_INVALID);
  });

  it('duas chamadas simultâneas: só uma consome', async () => {
    const w = adsWorld();
    const s = new OAuthStateService(w.prisma);
    const st = await s.issue('meta', WS_A, OWNER);
    const r = await Promise.allSettled([s.consume('meta', st), s.consume('meta', st)]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
  });

  it('apaga estados vencidos ao emitir', async () => {
    const w = adsWorld();
    const s = new OAuthStateService(w.prisma);
    await s.issue('meta', WS_A, OWNER);
    w.t['oauth_states']!.rows[0]!.expires_at = new Date(Date.now() - 1000);
    await s.issue('meta', WS_A, OWNER);
    expect(w.t['oauth_states']!.rows).toHaveLength(1);
  });
});
