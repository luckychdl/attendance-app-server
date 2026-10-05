import { Inject, Injectable } from '@nestjs/common';

import { badRequest, conflict, forbidden, notFound } from '../common/errors.ts';
import { CLOCK, REPO } from '../common/tokens.ts';
import { uuid } from '../common/zod.pipe.ts';
import {
  computeBalance,
  countLeaveDays,
  formatDays,
  grantedDays,
  HOURLY_LEAVE_HOURS,
  hourlySlots,
  isActive,
  isCancellable,
  isSingleDay,
  LEAVE_TYPE_LABEL,
  overlaps,
} from '../lib/leave-rules.ts';
import { type Clock, formatClock, isWeekend, parseClock } from '../lib/time.ts';
import type { EmployeeRow, Repo } from '../repo/types.ts';
import type { LeaveInput } from '../types.ts';

@Injectable()
export class LeaveService {
  /**
   * 직원별로 신청을 한 줄로 세운다. 잔여 확인과 저장 사이에 같은 사람의 다른 신청이
   * 끼어들어 잔여를 넘기거나 겹치는 일을 막는다. (서버를 여러 대로 늘리면 DB 잠금으로 바꿔야 한다.)
   */
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(
    @Inject(REPO) private readonly repo: Repo,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private inOrder<T>(key: string, task: () => Promise<T>): Promise<T> {
    const run = (this.queues.get(key) ?? Promise.resolve()).then(task, task);
    const tail = run.catch(() => {});
    this.queues.set(key, tail);
    tail.then(() => {
      if (this.queues.get(key) === tail) this.queues.delete(key);
    });
    return run;
  }

  private async find(id: string) {
    const leave = uuid.safeParse(id).success ? await this.repo.findLeave(id) : null;
    if (!leave) throw notFound('신청 내역을 찾을 수 없습니다.');
    return leave;
  }

  /** 연간 연차 현황 */
  async balance(employee: EmployeeRow, year: number) {
    const leaves = await this.repo.listLeaves(employee.id, `${year}-01-01`, `${year}-12-31`);
    return computeBalance(leaves, year, grantedDays(employee, year));
  }

  /** 기간(YYYY-MM-DD)과 겹치는 본인 신청. 시작일 최신순 */
  list(employeeId: string, from: string, to: string) {
    return this.repo.listLeaves(employeeId, from, to);
  }

  /** 결재자에게 올라온 대기 신청. 시작일이 가까운 순 */
  async inbox(approver: EmployeeRow) {
    if (approver.role !== 'manager') return [];
    const pending = await this.repo.listPendingLeaves(approver.department);
    return pending.filter((leave) => leave.employeeId !== approver.id);
  }

  async request(me: EmployeeRow, input: Omit<LeaveInput, 'employeeId'>) {
    const { repo, clock } = this;
    const { type, startDate } = input;
    const endDate = isSingleDay(type) ? startDate : input.endDate;
    const now = clock.zoned(clock.now());
    const today = now.dateKey;

    if (endDate < startDate) throw badRequest('종료일이 시작일보다 빠릅니다.');
    if (startDate < today) throw badRequest('지난 날짜로는 신청할 수 없습니다.');
    if (startDate.slice(0, 4) !== endDate.slice(0, 4)) {
      throw badRequest('해를 넘기는 휴가는 연도별로 나눠서 신청해 주세요.');
    }

    const holidays = new Set(await repo.listHolidays(startDate, endDate));
    if (isSingleDay(type)) {
      if (isWeekend(startDate)) {
        throw badRequest(`${LEAVE_TYPE_LABEL[type]}는 평일에만 신청할 수 있습니다.`);
      }
      if (holidays.has(startDate)) throw badRequest('공휴일에는 휴가를 신청할 수 없습니다.');
    }

    // 시차는 정해진 시간대 중 하나여야 한다. 종료 시각은 점심을 건너 서버가 정한다.
    const worksite = await repo.getWorksite();
    let startTime: string | null = null;
    let endTime: string | null = null;
    let hours: number | null = null;
    if (type === 'hourly') {
      hours = input.hours ?? null;
      if (!HOURLY_LEAVE_HOURS.some((option) => option === hours)) {
        throw badRequest('시차는 2시간 단위(2·4·6시간)로 신청해 주세요.');
      }
      const start = input.startTime ? parseClock(input.startTime) : NaN;
      const slot = hourlySlots(worksite, hours!).find((item) => item.start === start);
      if (!slot) throw badRequest('근무시간 안에서 시작 시각을 골라 주세요.');
      if (startDate === today && slot.start <= Math.floor(now.minutes)) {
        throw badRequest('이미 지난 시간으로는 시차를 신청할 수 없습니다.');
      }
      startTime = formatClock(slot.start);
      endTime = formatClock(slot.end);
    }

    const days = countLeaveDays(type, startDate, endDate, hours, holidays);
    if (days === 0) throw badRequest('고른 기간에 평일이 없습니다.');

    return this.inOrder(me.id, async () => {
      const mine = await repo.listLeaves(me.id, startDate, endDate);
      const clash = mine.find(
        (item) =>
          isActive(item) &&
          overlaps(item, { type, startDate, endDate, startTime, endTime }, worksite),
      );
      if (clash) throw conflict('이미 신청한 휴가와 시간이 겹칩니다.');

      const { remaining } = await this.balance(me, Number(startDate.slice(0, 4)));
      if (days > remaining) {
        throw conflict(`남은 연차가 ${formatDays(remaining)}일이라 신청할 수 없습니다.`);
      }

      // 팀장 위로는 결재자가 없으므로 바로 승인한다.
      const autoApprove = me.role === 'manager';
      const requestedAt = clock.now().toISOString();

      return repo.insertLeave({
        employeeId: me.id,
        employeeName: me.name,
        department: me.department,
        type,
        startDate,
        endDate,
        startTime,
        endTime,
        days,
        reason: input.reason || null,
        status: autoApprove ? 'approved' : 'pending',
        requestedAt,
        decidedAt: autoApprove ? requestedAt : null,
        decidedBy: autoApprove ? me.name : null,
      });
    });
  }

  /** 본인 신청 취소. 승인된 건은 시작일 전까지만 */
  async cancel(id: string, me: EmployeeRow) {
    const leave = await this.find(id);
    const notCancellable = '이미 시작했거나 처리가 끝난 휴가입니다.';

    if (leave.employeeId !== me.id) throw forbidden('본인 신청만 취소할 수 있습니다.');
    if (!isCancellable(leave, this.clock.today())) throw conflict(notCancellable);

    const updated = await this.repo.transitionLeave(leave.id, [leave.status], {
      status: 'cancelled',
    });
    if (!updated) throw conflict(notCancellable);
    return updated;
  }

  /** 결재자는 같은 부서의 팀장. 본인 신청은 결재하지 않는다. */
  async decide(id: string, approver: EmployeeRow, status: 'approved' | 'rejected') {
    const leave = await this.find(id);
    const alreadyDone = '이미 처리된 신청입니다.';

    if (approver.role !== 'manager' || approver.department !== leave.department) {
      throw forbidden('이 신청을 결재할 권한이 없습니다.');
    }
    if (leave.employeeId === approver.id) throw forbidden('본인 신청은 결재할 수 없습니다.');
    if (leave.status !== 'pending') throw conflict(alreadyDone);

    const updated = await this.repo.transitionLeave(id, ['pending'], {
      status,
      decidedAt: this.clock.now().toISOString(),
      decidedBy: approver.name,
    });
    if (!updated) throw conflict(alreadyDone);
    return updated;
  }
}
