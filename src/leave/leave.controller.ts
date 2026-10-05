import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';

import { CurrentEmployee } from '../auth/decorators.ts';
import { assertSelf, dateKey, ZodPipe } from '../common/zod.pipe.ts';
import type { EmployeeRow } from '../repo/types.ts';
import { LeaveService } from './leave.service.ts';

const balanceQuery = z.object({
  employeeId: z.string(),
  year: z.coerce.number().int().min(2000).max(2100),
});
const listQuery = z.object({ employeeId: z.string(), from: dateKey, to: dateKey });
const inboxQuery = z.object({ approverId: z.string() });

const requestSchema = z.object({
  employeeId: z.string(),
  type: z.enum(['annual', 'halfAm', 'halfPm', 'hourly']),
  startDate: dateKey,
  endDate: dateKey,
  startTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .nullish(),
  hours: z.number().nullish(),
  reason: z.string().trim().max(500).nullish(),
});

@Controller('leave')
export class LeaveController {
  constructor(private readonly leave: LeaveService) {}

  @Get('balance')
  balance(
    @CurrentEmployee() me: EmployeeRow,
    @Query(new ZodPipe(balanceQuery)) query: z.infer<typeof balanceQuery>,
  ) {
    assertSelf(query.employeeId, me);
    return this.leave.balance(me, query.year);
  }

  @Get('requests')
  list(
    @CurrentEmployee() me: EmployeeRow,
    @Query(new ZodPipe(listQuery)) query: z.infer<typeof listQuery>,
  ) {
    assertSelf(query.employeeId, me);
    return this.leave.list(me.id, query.from, query.to);
  }

  @Get('inbox')
  inbox(
    @CurrentEmployee() me: EmployeeRow,
    @Query(new ZodPipe(inboxQuery)) query: z.infer<typeof inboxQuery>,
  ) {
    assertSelf(query.approverId, me);
    return this.leave.inbox(me);
  }

  @Post('requests')
  @HttpCode(200)
  request(
    @CurrentEmployee() me: EmployeeRow,
    @Body(new ZodPipe(requestSchema)) body: z.infer<typeof requestSchema>,
  ) {
    assertSelf(body.employeeId, me);
    return this.leave.request(me, body);
  }

  @Post('requests/:id/cancel')
  @HttpCode(200)
  cancel(@CurrentEmployee() me: EmployeeRow, @Param('id') id: string) {
    return this.leave.cancel(id, me);
  }

  @Post('requests/:id/approve')
  @HttpCode(200)
  approve(@CurrentEmployee() me: EmployeeRow, @Param('id') id: string) {
    return this.leave.decide(id, me, 'approved');
  }

  @Post('requests/:id/reject')
  @HttpCode(200)
  reject(@CurrentEmployee() me: EmployeeRow, @Param('id') id: string) {
    return this.leave.decide(id, me, 'rejected');
  }
}
