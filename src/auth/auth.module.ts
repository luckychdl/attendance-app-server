import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

import { AuthController } from './auth.controller.ts';
import { AuthGuard } from './auth.guard.ts';
import { AuthService } from './auth.service.ts';

@Module({
  // 서명 키와 만료 시각은 AuthService 가 요청마다 넘긴다.
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AuthModule {}
