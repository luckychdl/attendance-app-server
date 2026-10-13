import { Module } from '@nestjs/common';

import { AttendanceModule } from '../attendance/attendance.module.ts';
import { AdminController } from './admin.controller.ts';
import { AdminService } from './admin.service.ts';

@Module({
  imports: [AttendanceModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
