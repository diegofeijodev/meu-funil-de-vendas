import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { FastifyReply } from 'fastify';

const CODE_BY_STATUS: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'TOO_MANY_REQUESTS',
  502: 'BAD_GATEWAY',
  503: 'SERVICE_UNAVAILABLE',
};

/** Normaliza TODA resposta de erro para `{ error: { code, message } }` (contrato §1). */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const reply = host.switchToHttp().getResponse<FastifyReply>();

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'Erro interno do servidor';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = CODE_BY_STATUS[status] ?? 'ERROR';
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (typeof body === 'object' && body !== null) {
        const b = body as Record<string, unknown>;
        if (Array.isArray(b.message)) message = (b.message as string[]).join(' | ');
        else if (typeof b.message === 'string') message = b.message;
        else message = exception.message;
        if (typeof b.code === 'string') code = b.code;
      }
      if (status === 429) {
        code = 'TOO_MANY_REQUESTS';
        message = 'Muitas requisições. Tente novamente em instantes.';
      }
    } else if (exception instanceof Error) {
      // Erros do Fastify (corpo grande demais, JSON inválido, multipart) trazem `statusCode`.
      const sc = (exception as { statusCode?: unknown }).statusCode;
      if (typeof sc === 'number' && sc >= 400 && sc < 500) {
        status = sc;
        code = CODE_BY_STATUS[sc] ?? 'BAD_REQUEST';
        message = sc === 413 ? 'Arquivo ou corpo grande demais.' : exception.message;
      } else {
        this.logger.error(exception.message, exception.stack);
      }
    }

    reply.status(status).send({ error: { code, message } });
  }
}
