import { Module } from '@nestjs/common';

import { WorksiteController } from './worksite.controller.ts';
import { WorksiteService } from './worksite.service.ts';

@Module({
  controllers: [WorksiteController],
  providers: [WorksiteService],
})
export class WorksiteModule {}
