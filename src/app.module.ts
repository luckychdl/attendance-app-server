import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';

import { AdminModule } from './admin/admin.module.ts';
import { AttendanceModule } from './attendance/attendance.module.ts';
import { AuthModule } from './auth/auth.module.ts';
import { CoreModule } from './common/core.module.ts';
import { TextExceptionFilter } from './common/text-exception.filter.ts';
import { HealthController } from './health.controller.ts';
import { LeaveModule } from './leave/leave.module.ts';
import { WorksiteModule } from './worksite/worksite.module.ts';

@Module({
  imports: [CoreModule, AuthModule, AttendanceModule, WorksiteModule, LeaveModule, AdminModule],
  controllers: [HealthController],
  providers: [{ provide: APP_FILTER, useClass: TextExceptionFilter }],
})
export class AppModule {}
