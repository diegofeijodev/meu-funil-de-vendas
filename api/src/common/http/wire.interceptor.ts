import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { map, Observable } from 'rxjs';
import { toWire } from './wire';

/** Interceptor global: Decimal/BigInt/Date do Prisma → formato de fio snake_case do protótipo. */
@Injectable()
export class WireInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((data) => toWire(data)));
  }
}
