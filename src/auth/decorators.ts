import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';

import type { EmployeeRow } from '../repo/types.ts';

export const IS_PUBLIC = 'isPublic';

/** 로그인 없이 부를 수 있는 경로 */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** AuthGuard 가 토큰으로 찾아 둔 직원 */
export const CurrentEmployee = createParamDecorator(
  (_data: unknown, context: ExecutionContext): EmployeeRow =>
    context.switchToHttp().getRequest().employee,
);
