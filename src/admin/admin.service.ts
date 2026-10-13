import { Inject, Injectable } from '@nestjs/common';
import bcrypt from 'bcryptjs';

import { AttendanceService } from '../attendance/attendance.service.ts';
import { badRequest, conflict, notFound } from '../common/errors.ts';
import { CLOCK, REPO } from '../common/tokens.ts';
import { computeBalance, grantedDays } from '../lib/leave-rules.ts';
import type { Clock } from '../lib/time.ts';
import type { EmployeePatch, EmployeeRow, LeaveFilter, Repo } from '../repo/types.ts';
import type { AdminEmployee, AdminOverview, EmployeeRole, LeaveRequest } from '../types.ts';

export type CreateEmployeeInput = {
  employeeNo: string;
  name: string;
  department: string;
  position: string;
  role: EmployeeRole;
  hiredAt?: string;
  password: string;
};

export type UpdateEmployeeInput = Omit<EmployeePatch, 'passwordHash'> & { password?: string };

function toAdminEmployee(
  row: EmployeeRow,
  leaves: readonly LeaveRequest[],
  year: number,
): AdminEmployee {
  return {
    id: row.id,
    employeeNo: row.employeeNo,
    name: row.name,
    department: row.department,
    position: row.position,
    role: row.role,
    companyName: row.companyName,
    hiredAt: row.hiredAt,
    annualLeaveDays: row.annualLeaveDays,
    active: row.active,
    leave: computeBalance(leaves, year, grantedDays(row, year)),
  };
}

/** 회사 단위 조회와 인사 관리. 호출자는 ManagerGuard 를 지난 관리자이고, 범위는 항상 그 사람의 회사다. */
@Injectable()
export class AdminService {
  constructor(
    @Inject(REPO) private readonly repo: Repo,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly attendanceService: AttendanceService,
  ) {}

  private thisYear() {
    return Number(this.clock.today().slice(0, 4));
  }

  private async leavesOf(employee: EmployeeRow, year: number) {
    return this.repo.listLeaves(employee.id, `${year}-01-01`, `${year}-12-31`);
  }

  /** 오늘 누가 나왔고 누가 쉬는지 */
  async overview(me: EmployeeRow): Promise<AdminOverview> {
    const date = this.clock.today();
    const [records, leaves, pending] = await Promise.all([
      this.repo.listCompanyAttendance(me.companyId, date, date),
      this.repo.listCompanyLeaves(me.companyId, { from: date, to: date, status: 'approved' }),
      this.repo.listCompanyLeaves(me.companyId, { status: 'pending' }),
    ]);
    return {
      date,
      records: records.map((record) => this.attendanceService.present(record)),
      leaves,
      pendingLeaves: pending.length,
    };
  }

  /** 전 직원 (퇴사자 포함) + 그 해의 연차 현황. 사번 순 */
  async employees(me: EmployeeRow, year = this.thisYear()): Promise<AdminEmployee[]> {
    const [rows, leaves] = await Promise.all([
      this.repo.listEmployees(me.companyId),
      this.repo.listCompanyLeaves(me.companyId, { from: `${year}-01-01`, to: `${year}-12-31` }),
    ]);

    const byEmployee = new Map<string, LeaveRequest[]>();
    for (const leave of leaves) {
      const list = byEmployee.get(leave.employeeId) ?? [];
      list.push(leave);
      byEmployee.set(leave.employeeId, list);
    }
    return rows.map((row) => toAdminEmployee(row, byEmployee.get(row.id) ?? [], year));
  }

  async createEmployee(me: EmployeeRow, input: CreateEmployeeInput): Promise<AdminEmployee> {
    const { password, ...profile } = input;
    const created = await this.repo.insertEmployee(me.companyId, {
      ...profile,
      passwordHash: await bcrypt.hash(password, 10),
    });
    if (!created) throw conflict('이미 쓰고 있는 사번입니다.');
    return toAdminEmployee(created, [], this.thisYear());
  }

  /** 다른 회사의 직원은 없는 것으로 본다. */
  async updateEmployee(me: EmployeeRow, id: string, input: UpdateEmployeeInput) {
    const target = await this.repo.findEmployeeById(id);
    if (!target || target.companyId !== me.companyId) throw notFound('직원을 찾을 수 없습니다.');

    // 마지막 관리자가 스스로 권한을 내려놓아 회사를 관리할 사람이 없어지는 일을 막는다.
    if (target.id === me.id && (input.role === 'member' || input.active === false)) {
      throw badRequest('본인의 권한과 재직 상태는 직접 바꿀 수 없습니다.');
    }

    const { password, ...patch } = input;
    const updated = await this.repo.updateEmployee(target.id, {
      ...patch,
      ...(password ? { passwordHash: await bcrypt.hash(password, 10) } : {}),
    });

    const year = this.thisYear();
    return toAdminEmployee(updated, await this.leavesOf(updated, year), year);
  }

  /** 기간 내 회사 전체 근태 기록. 근무일 최신순 */
  async attendance(me: EmployeeRow, from: string, to: string, employeeId?: string) {
    const records = await this.repo.listCompanyAttendance(me.companyId, from, to, employeeId);
    return records.map((record) => this.attendanceService.present(record));
  }

  /** 회사 전체 휴가 신청. 시작일 최신순 */
  leaves(me: EmployeeRow, filter: LeaveFilter) {
    return this.repo.listCompanyLeaves(me.companyId, filter);
  }
}
