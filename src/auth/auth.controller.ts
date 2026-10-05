import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { z } from 'zod';

import { ZodPipe } from '../common/zod.pipe.ts';
import type { EmployeeRow } from '../repo/types.ts';
import { AuthService, toPublicEmployee } from './auth.service.ts';
import { CurrentEmployee, Public } from './decorators.ts';

const loginSchema = z.object({
  employeeNo: z.string().trim().min(1).max(32),
  password: z.string().min(1).max(128),
});

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body(new ZodPipe(loginSchema)) body: z.infer<typeof loginSchema>) {
    return this.auth.login(body.employeeNo, body.password);
  }

  /** 토큰이 아직 유효한지, 인사 정보가 바뀌지 않았는지 확인할 때 쓴다. */
  @Get('me')
  me(@CurrentEmployee() me: EmployeeRow) {
    return toPublicEmployee(me);
  }
}
