import { Body, Controller, Get, HttpCode, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';

import { CurrentEmployee } from '../auth/decorators.ts';
import { assertSelf, dateKey, monthKey, ZodPipe } from '../common/zod.pipe.ts';
import type { EmployeeRow } from '../repo/types.ts';
import { AttendanceService } from './attendance.service.ts';

const todayQuery = z.object({ employeeId: z.string() });
const recordsQuery = z.object({ employeeId: z.string(), from: dateKey, to: dateKey });
const summaryQuery = z.object({ employeeId: z.string(), month: monthKey });

const checkSchema = z.object({
  employeeId: z.string(),
  location: z
    .object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      accuracy: z.number().nullish(),
    })
    .nullable(),
  note: z.string().trim().max(200).nullish(),
});

type CheckBody = z.infer<typeof checkSchema>;

@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get('today')
  async today(
    @CurrentEmployee() me: EmployeeRow,
    @Query(new ZodPipe(todayQuery)) query: z.infer<typeof todayQuery>,
    @Res() response: Response,
  ) {
    assertSelf(query.employeeId, me);
    // 출근 전이면 null. Nest 는 null 을 빈 본문으로 보내는데 앱은 JSON 을 기대하므로 직접 내려보낸다.
    response.json(await this.attendance.today(me.id));
  }

  @Get('records')
  records(
    @CurrentEmployee() me: EmployeeRow,
    @Query(new ZodPipe(recordsQuery)) query: z.infer<typeof recordsQuery>,
  ) {
    assertSelf(query.employeeId, me);
    return this.attendance.list(me.id, query.from, query.to);
  }

  @Get('summary')
  summary(
    @CurrentEmployee() me: EmployeeRow,
    @Query(new ZodPipe(summaryQuery)) query: z.infer<typeof summaryQuery>,
  ) {
    assertSelf(query.employeeId, me);
    return this.attendance.summary(me.id, query.month);
  }

  @Post('check-in')
  @HttpCode(200)
  checkIn(
    @CurrentEmployee() me: EmployeeRow,
    @Body(new ZodPipe(checkSchema)) body: CheckBody,
  ) {
    assertSelf(body.employeeId, me);
    return this.attendance.checkIn(me, body);
  }

  @Post('check-out')
  @HttpCode(200)
  checkOut(
    @CurrentEmployee() me: EmployeeRow,
    @Body(new ZodPipe(checkSchema)) body: CheckBody,
  ) {
    assertSelf(body.employeeId, me);
    return this.attendance.checkOut(me, body);
  }
}
