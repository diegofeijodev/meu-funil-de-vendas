import { KeyedQueue } from '../keyed-queue';

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe('KeyedQueue', () => {
  it('mesma chave: uma tarefa de cada vez, na ordem em que entraram', async () => {
    const q = new KeyedQueue();
    const log: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const a = q.run('k', async () => { log.push('a:início'); await gate; log.push('a:fim'); return 'A'; });
    const b = q.run('k', async () => { log.push('b:início'); return 'B'; });
    const c = q.run('k', async () => { log.push('c:início'); return 'C'; });
    await tick();
    expect(log).toEqual(['a:início']);
    release();
    expect(await Promise.all([a, b, c])).toEqual(['A', 'B', 'C']);
    expect(log).toEqual(['a:início', 'a:fim', 'b:início', 'c:início']);
  });

  it('erro de uma tarefa chega a quem a pediu e não trava as seguintes', async () => {
    const q = new KeyedQueue();
    const bad = q.run('k', async () => { throw new Error('quebrou'); });
    const next = q.run('k', async () => 'segue');
    await expect(bad).rejects.toThrow('quebrou');
    await expect(next).resolves.toBe('segue');
  });

  it('chaves diferentes não esperam umas pelas outras', async () => {
    const q = new KeyedQueue();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = q.run('a', async () => { await gate; return 'lenta'; });
    expect(await q.run('b', async () => 'rápida')).toBe('rápida');
    release();
    expect(await slow).toBe('lenta');
  });

  it('a fila da chave é limpa quando esvazia (sem vazamento), com sucesso ou erro', async () => {
    const q = new KeyedQueue();
    await q.run('a', async () => 1);
    await q.run('b', async () => { throw new Error('x'); }).catch(() => undefined);
    await Promise.all([q.run('a', async () => 1), q.run('a', async () => 2), q.run('c', async () => 3)]);
    await tick();
    expect(q.size).toBe(0);
  });

  it('uma tarefa nova que entra enquanto a chave ainda roda mantém a fila viva até acabar', async () => {
    const q = new KeyedQueue();
    const out: number[] = [];
    const first = q.run('k', async () => { await tick(); out.push(1); });
    await tick();
    const second = q.run('k', async () => { out.push(2); });
    await Promise.all([first, second]);
    await tick();
    expect(out).toEqual([1, 2]);
    expect(q.size).toBe(0);
  });
});
