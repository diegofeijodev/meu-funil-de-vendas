module.exports = {
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  // ts-jest só transpila (isolatedModules): a checagem de tipos é o `npm run typecheck`.
  // Com a checagem por arquivo, uma suíte sozinha passava de 1,2 GB e travava a máquina do dono.
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.spec.json' }] },
  // Máquina do dono trava com paralelismo — ver CLAUDE.md § Regras de baixo consumo.
  maxWorkers: 1,
};
