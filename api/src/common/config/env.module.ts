import { Global, Module } from '@nestjs/common';
import { Env, validateEnv } from './env.validation';

/** Token de injeção do ambiente validado (`@Inject(ENV) env: Env`). */
export const ENV = Symbol('ENV');

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: (): Env => validateEnv(process.env) }],
  exports: [ENV],
})
export class EnvModule {}
