import { IsOptional, IsString } from 'class-validator';

// Validação de e-mail/senha é feita no serviço (mensagens iguais às do GoTrue);
// o DTO só garante a lista de campos aceitos (whitelist + forbidNonWhitelisted).
export class SignupDto {
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() password?: string;
  @IsOptional() @IsString() full_name?: string;
  @IsOptional() @IsString() company_name?: string;
}

export class LoginDto {
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() password?: string;
}

export class RefreshDto {
  @IsOptional() @IsString() refresh_token?: string;
}
