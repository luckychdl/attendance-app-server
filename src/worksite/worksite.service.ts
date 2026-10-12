import { Inject, Injectable } from '@nestjs/common';

import { badRequest, forbidden } from '../common/errors.ts';
import { REPO } from '../common/tokens.ts';
import { workEndMinutes, workStartMinutes } from '../lib/leave-rules.ts';
import type { EmployeeRow, Repo, WorksitePatch } from '../repo/types.ts';

@Injectable()
export class WorksiteService {
  constructor(@Inject(REPO) private readonly repo: Repo) {}

  get(me: EmployeeRow) {
    return this.repo.getWorksite(me.companyId);
  }

  /** 근무지를 옮기면 회사 전 직원의 출퇴근 기준이 바뀌므로 팀장만 할 수 있다. */
  async update(me: EmployeeRow, patch: WorksitePatch) {
    if (me.role !== 'manager') throw forbidden('근무지 설정은 관리자만 변경할 수 있습니다.');

    const current = await this.repo.getWorksite(me.companyId);
    const next = { ...current, ...patch };
    if (workStartMinutes(next) >= workEndMinutes(next)) {
      throw badRequest('근무 종료 시각은 시작 시각보다 늦어야 합니다.');
    }

    return this.repo.updateWorksite(current.id, patch);
  }
}
