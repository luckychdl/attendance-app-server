import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';

import { forbidden } from '../common/errors.ts';
import type { EmployeeRow } from '../repo/types.ts';

/** 관리자 페이지 전용 경로. 전역 AuthGuard 가 찾아 둔 직원이 관리자(manager)여야 한다. */
@Injectable()
export class ManagerGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const employee: EmployeeRow | undefined = context.switchToHttp().getRequest().employee;
    if (employee?.role !== 'manager') throw forbidden('관리자만 사용할 수 있습니다.');
    return true;
  }
}
