import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['test/**/*.test.ts'] },
  // Nest 의 의존성 주입은 데코레이터 메타데이터가 필요해서 SWC 로 변환한다.
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
