import { Global, Module } from '@nestjs/common';

import { type Env, loadEnv } from '../env.ts';
import { createClock } from '../lib/time.ts';
import { createSupabaseRepo } from '../repo/supabase.ts';
import { CLOCK, ENV, REPO } from './tokens.ts';

/** 어느 모듈에서나 쓰는 환경 변수 · 시계 · 저장소. 테스트는 이 셋을 바꿔 끼운다. */
@Global()
@Module({
  providers: [
    { provide: ENV, useFactory: loadEnv },
    {
      provide: CLOCK,
      inject: [ENV],
      useFactory: (env: Env) => createClock(env.timeZone),
    },
    {
      provide: REPO,
      inject: [ENV],
      useFactory: (env: Env) => createSupabaseRepo(env.supabaseUrl, env.supabaseServiceRoleKey),
    },
  ],
  exports: [ENV, CLOCK, REPO],
})
export class CoreModule {}
