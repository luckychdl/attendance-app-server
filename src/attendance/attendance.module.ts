import { Module } from '@nestjs/common';

import { AttendanceController } from './attendance.controller.ts';
import { AttendanceService } from './attendance.service.ts';

@Module({
  controllers: [AttendanceController],
  providers: [AttendanceService],
  exports: [AttendanceService],
})
export class AttendanceModule {}
