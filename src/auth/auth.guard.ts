import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { unauthorized } from '../common/errors.ts';
import { AuthService } from './auth.service.ts';
import { IS_PUBLIC } from './decorators.ts';

/** 전역 가드. @Public() 이 붙지 않은 모든 경로에서 Bearer 토큰을 요구한다. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const token = request.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (!token) throw unauthorized();

    request.employee = await this.auth.authenticate(token);
    return true;
  }
}
