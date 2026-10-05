import { Module } from '@nestjs/common';

import { LeaveController } from './leave.controller.ts';
import { LeaveService } from './leave.service.ts';

@Module({
  controllers: [LeaveController],
  providers: [LeaveService],
})
export class LeaveModule {}
