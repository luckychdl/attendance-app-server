import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { z } from 'zod';

import { ZodPipe } from '../common/zod.pipe.ts';
import type { EmployeeRow } from '../repo/types.ts';
import { AuthService, toPublicEmployee } from './auth.service.ts';
import { CurrentEmployee, Public } from './decorators.ts';

const companyName = z.string().trim().min(1).max(50);
const employeeNo = z.string().trim().min(1).max(32);

const loginSchema = z.object({
  companyName,
  employeeNo,
  password: z.string().min(1).max(128),
});

const signupSchema = z.object({
  companyName,
  employeeNo,
  name: z.string().trim().min(1).max(30),
  department: z.string().trim().min(1).max(30),
  position: z.string().trim().min(1).max(30),
  password: z.string().min(4).max(128),
});

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body(new ZodPipe(loginSchema)) body: z.infer<typeof loginSchema>) {
    return this.auth.login(body.companyName, body.employeeNo, body.password);
  }

  /** 회사명이 처음이면 회사를 만들고 관리자로, 이미 있으면 그 회사의 팀원으로 가입한다. */
  @Public()
  @Post('signup')
  @HttpCode(200)
  signup(@Body(new ZodPipe(signupSchema)) body: z.infer<typeof signupSchema>) {
    return this.auth.signup(body);
  }

  /** 토큰이 아직 유효한지, 인사 정보가 바뀌지 않았는지 확인할 때 쓴다. */
  @Get('me')
  me(@CurrentEmployee() me: EmployeeRow) {
    return toPublicEmployee(me);
  }
}
