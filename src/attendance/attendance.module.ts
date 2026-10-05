import { Module } from '@nestjs/common';

import { AttendanceController } from './attendance.controller.ts';
import { AttendanceService } from './attendance.service.ts';

@Module({
  controllers: [AttendanceController],
  providers: [AttendanceService],
})
export class AttendanceModule {}
