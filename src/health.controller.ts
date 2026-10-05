import { Controller, Get } from '@nestjs/common';

import { Public } from './auth/decorators.ts';

@Controller('health')
export class HealthController {
  @Public()
  @Get()
  check() {
    return { ok: true };
  }
}
