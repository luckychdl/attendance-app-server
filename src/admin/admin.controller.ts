import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';

import { CurrentEmployee } from '../auth/decorators.ts';
import { badRequest } from '../common/errors.ts';
import { dateKey, ZodPipe } from '../common/zod.pipe.ts';
import { dayDiff } from '../lib/time.ts';
import type { EmployeeRow } from '../repo/types.ts';
import { AdminService } from './admin.service.ts';
import { ManagerGuard } from './manager.guard.ts';

/** 한 번에 조회할 수 있는 근태 기간(일) */
const MAX_RANGE_DAYS = 366;

const text = z.string().trim().min(1).max(30);
const role = z.enum(['member', 'manager']);
const password = z.string().min(4).max(128);

const employeesQuery = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

const createSchema = z.object({
  employeeNo: z.string().trim().min(1).max(32),
  name: text,
  department: text,
  position: text,
  role: role.default('member'),
  hiredAt: dateKey.optional(),
  password,
});

const patchSchema = z
  .object({
    name: text,
    department: text,
    position: text,
    role,
    hiredAt: dateKey,
    /** null 이면 근속연수로 계산한다. */
    annualLeaveDays: z.number().min(0).max(60).nullable(),
    active: z.boolean(),
    password,
  })
  .partial();

const attendanceQuery = z.object({
  from: dateKey,
  to: dateKey,
  employeeId: z.string().optional(),
});

const leavesQuery = z.object({
  from: dateKey.optional(),
  to: dateKey.optional(),
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(),
});

/** 관리자 페이지(attendance-app-admin)가 쓰는 회사 단위 조회와 인사 관리 */
@Controller('admin')
@UseGuards(ManagerGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('overview')
  overview(@CurrentEmployee() me: EmployeeRow) {
    return this.admin.overview(me);
  }

  @Get('employees')
  employees(
    @CurrentEmployee() me: EmployeeRow,
    @Query(new ZodPipe(employeesQuery)) query: z.infer<typeof employeesQuery>,
  ) {
    return this.admin.employees(me, query.year);
  }

  @Post('employees')
  @HttpCode(200)
  create(
    @CurrentEmployee() me: EmployeeRow,
    @Body(new ZodPipe(createSchema)) body: z.infer<typeof createSchema>,
  ) {
    return this.admin.createEmployee(me, body);
  }

  @Patch('employees/:id')
  update(
    @CurrentEmployee() me: EmployeeRow,
    @Param('id') id: string,
    @Body(new ZodPipe(patchSchema)) body: z.infer<typeof patchSchema>,
  ) {
    return this.admin.updateEmployee(me, id, body);
  }

  @Get('attendance')
  attendance(
    @CurrentEmployee() me: EmployeeRow,
    @Query(new ZodPipe(attendanceQuery)) query: z.infer<typeof attendanceQuery>,
  ) {
    const days = dayDiff(query.from, query.to);
    if (days < 0) throw badRequest('종료일이 시작일보다 빠릅니다.');
    if (days > MAX_RANGE_DAYS) throw badRequest('근태 기록은 한 번에 1년까지만 조회할 수 있습니다.');
    return this.admin.attendance(me, query.from, query.to, query.employeeId);
  }

  @Get('leaves')
  leaves(
    @CurrentEmployee() me: EmployeeRow,
    @Query(new ZodPipe(leavesQuery)) query: z.infer<typeof leavesQuery>,
  ) {
    return this.admin.leaves(me, query);
  }
}
