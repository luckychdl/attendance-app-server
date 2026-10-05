import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.ts';
import { type Env, loadEnv } from './env.ts';

// 설정이 빠졌으면 Nest 를 띄우기 전에 한 줄로 알려 주고 끝낸다.
let env: Env;
try {
  env = loadEnv();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const app = await NestFactory.create(AppModule);
// 앱의 웹 빌드(expo start --web)에서도 부를 수 있게 연다. 인증은 Bearer 토큰이라 쿠키는 쓰지 않는다.
app.enableCors();
await app.listen(env.port);
console.log(`출근체크 서버 실행 중: http://localhost:${env.port} (${env.timeZone})`);
