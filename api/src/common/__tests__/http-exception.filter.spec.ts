import { BadRequestException, ForbiddenException, HttpException } from '@nestjs/common';
import { HttpExceptionFilter } from '../filters/http-exception.filter';

function run(exception: unknown) {
  let sent: any; let status = 0;
  const reply = { status: (s: number) => { status = s; return { send: (b: unknown) => { sent = b; } }; } };
  new HttpExceptionFilter().catch(exception, { switchToHttp: () => ({ getResponse: () => reply }) } as any);
  return { status, sent };
}

describe('HttpExceptionFilter → { error: { code, message } }', () => {
  it('respeita code/message do corpo', () => {
    expect(run(new ForbiddenException({ code: 'FORBIDDEN', message: 'Você não tem acesso a esta empresa.' }))).toEqual({
      status: 403, sent: { error: { code: 'FORBIDDEN', message: 'Você não tem acesso a esta empresa.' } },
    });
  });
  it('mensagem de string e lista de validação', () => {
    expect(run(new HttpException('x', 404)).sent.error).toEqual({ code: 'NOT_FOUND', message: 'x' });
    expect(run(new BadRequestException(['a deve ser string', 'b obrigatório'])).sent.error.message).toBe('a deve ser string | b obrigatório');
  });
  it('429 e erro inesperado (500 sem vazar detalhe)', () => {
    expect(run(new HttpException('Too Many', 429))).toMatchObject({ status: 429, sent: { error: { code: 'TOO_MANY_REQUESTS' } } });
    expect(run(new Error('segredo interno'))).toEqual({ status: 500, sent: { error: { code: 'INTERNAL_ERROR', message: 'Erro interno do servidor' } } });
  });
  it('erro 4xx do Fastify (ex.: 413) vira o status certo', () => {
    const e = Object.assign(new Error('big'), { statusCode: 413 });
    expect(run(e)).toMatchObject({ status: 413, sent: { error: { code: 'PAYLOAD_TOO_LARGE' } } });
  });
});
