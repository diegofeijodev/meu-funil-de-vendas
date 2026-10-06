import { compareSync, hashSync } from 'bcryptjs';
import { AuthUser, DuplicateEmailError, mapUsers } from '../auth-map';

const now = new Date('2026-10-06T12:00:00Z');
const u = (id: string, o: Partial<AuthUser> = {}): AuthUser => ({ id, email: `${id}@x.com`, encrypted_password: '', created_at: '2026-01-01T00:00:00Z', ...o });

describe('mapUsers', () => {
  it('mantém id, e-mail em minúsculas e o hash bcrypt do Supabase (a senha atual continua valendo)', () => {
    const hash = hashSync('senha-atual', 4).replace(/^\$2b\$/, '$2a$');
    const p = mapUsers([u('a', { email: '  Dono@Exemplo.COM ', encrypted_password: hash })], [], now);
    expect(p.users).toEqual([{ id: 'a', email: 'dono@exemplo.com', password_hash: hash, google_sub: null, token_version: 0, created_at: '2026-01-01T00:00:00Z' }]);
    expect(compareSync('senha-atual', p.users[0]!.password_hash!)).toBe(true);
    expect(p.noLogin).toEqual([]);
  });

  it('liga o Google pelo provider_id (ou identity_data.sub) e ignora outros provedores', () => {
    const p = mapUsers(
      [u('g1'), u('g2'), u('e1')],
      [
        { user_id: 'g1', provider: 'google', provider_id: '111' },
        { user_id: 'g2', provider: 'google', provider_id: null, identity_data: { sub: '222' } },
        { user_id: 'e1', provider: 'email', provider_id: 'e1' },
      ],
      now,
    );
    expect(p.users.map((x) => [x.id, x.google_sub])).toEqual([['g1', '111'], ['g2', '222'], ['e1', null]]);
    expect(p.noLogin).toEqual(['e1']);
  });

  it('hash que não é bcrypt não vira senha: entra no relatório', () => {
    const p = mapUsers([u('a', { encrypted_password: 'md5:abc' })], [], now);
    expect(p.users[0]!.password_hash).toBeNull();
    expect(p.nonBcrypt).toEqual(['a']);
    expect(p.noLogin).toEqual(['a']);
  });

  it('apagada, banida (ainda valendo), anônima e sem e-mail ficam de fora; banimento vencido entra', () => {
    const p = mapUsers(
      [
        u('del', { deleted_at: '2026-09-01T00:00:00Z' }),
        u('ban', { banned_until: '2027-01-01T00:00:00Z' }),
        u('old', { banned_until: '2026-01-01T00:00:00Z', encrypted_password: '$2a$10$' + 'x'.repeat(53) }),
        u('anon', { is_anonymous: true }),
        u('noemail', { email: '  ' }),
      ],
      [],
      now,
    );
    expect(p.users.map((x) => x.id)).toEqual(['old']);
    expect(p.skipped).toEqual([
      { id: 'del', reason: 'apagada' },
      { id: 'ban', reason: 'banida' },
      { id: 'anon', reason: 'anonima' },
      { id: 'noemail', reason: 'sem_email' },
    ]);
  });

  it('e-mail repetido (sem diferenciar maiúsculas) aborta com os ids', () => {
    try {
      mapUsers([u('a', { email: 'X@y.com' }), u('b', { email: 'x@Y.com' }), u('c')], [], now);
      throw new Error('não abortou');
    } catch (e) {
      expect(e).toBeInstanceOf(DuplicateEmailError);
      expect((e as DuplicateEmailError).ids).toEqual([['a', 'b']]);
    }
  });
});
