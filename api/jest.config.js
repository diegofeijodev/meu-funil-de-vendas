module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  // Máquina do dono trava com paralelismo — ver CLAUDE.md § Regras de baixo consumo.
  maxWorkers: 1,
};
