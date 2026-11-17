/**
 * Fila em memória por chave: tarefas da mesma chave rodam uma de cada vez, na ordem; chaves diferentes não esperam umas pelas outras.
 * É em memória porque a API roda numa instância só (`CLAUDE.md`); com mais de uma instância seria preciso trava no banco.
 * Erro de uma tarefa chega só a quem a pediu e não trava as seguintes. A chave sai do mapa quando a última tarefa dela termina.
 */
export class KeyedQueue {
  private readonly tails = new Map<string, Promise<void>>();

  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    // `prev` nunca rejeita (a cauda engole o erro), então `then(fn)` basta.
    const prev = this.tails.get(key) ?? Promise.resolve();
    const result = prev.then(fn);
    const tail: Promise<void> = result.then(
      () => undefined,
      () => undefined,
    ).then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    this.tails.set(key, tail);
    return result;
  }

  /** Quantas chaves têm tarefa pendente (para teste: vazio quando tudo terminou). */
  get size(): number {
    return this.tails.size;
  }
}
