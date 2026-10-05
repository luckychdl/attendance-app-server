import { Body, Controller, Get, Patch } from '@nestjs/common';
import { z } from 'zod';

import { CurrentEmployee } from '../auth/decorators.ts';
import { ZodPipe } from '../common/zod.pipe.ts';
import type { EmployeeRow } from '../repo/types.ts';
import { WorksiteService } from './worksite.service.ts';

const hour = z.number().int().min(0).max(23);
const minute = z.number().int().min(0).max(59);

/** 앱은 근무지 전체를 보내지만 일부만 와도 받는다. id 는 무시한다. */
const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(50),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    radiusMeters: z.number().int().min(10).max(5000),
    startHour: hour,
    startMinute: minute,
    endHour: hour,
    endMinute: minute,
  })
  .partial();

@Controller('worksite')
export class WorksiteController {
  constructor(private readonly worksite: WorksiteService) {}

  @Get()
  get() {
    return this.worksite.get();
  }

  @Patch()
  update(
    @CurrentEmployee() me: EmployeeRow,
    @Body(new ZodPipe(patchSchema)) patch: z.infer<typeof patchSchema>,
  ) {
    return this.worksite.update(me, patch);
  }
}
