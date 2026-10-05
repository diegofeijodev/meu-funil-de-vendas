/**
 * Relógio virtual para testes de serviços que fazem polling com `sleep` + prazo (`now`):
 * `sleep(ms)` não espera, só avança `now` em `ms` — o laço termina no prazo sem girar milhões de vezes.
 */
export function virtualClock(start = Date.now()) {
  let t = start;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += Math.max(1, ms);
    },
  };
}

export function useVirtualClock(svc: { sleep: (ms: number) => Promise<void>; now: () => number }) {
  const c = virtualClock();
  svc.sleep = c.sleep;
  svc.now = c.now;
  return c;
}
