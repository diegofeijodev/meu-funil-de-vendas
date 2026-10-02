import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

export const notFound = (message = 'Não encontrado.') => new NotFoundException({ code: 'NOT_FOUND', message });
export const badRequest = (message: string) => new BadRequestException({ code: 'BAD_REQUEST', message });
export const conflict = (message: string) => new ConflictException({ code: 'CONFLICT', message });
