import { randomUUID } from 'node:crypto';

import type { EmployeeRow, Repo } from '../src/repo/types.ts';
import type { AttendanceRecord, LeaveRequest, Worksite } from '../src/types.ts';

export type MemoryData = {
  employees: EmployeeRow[];
  worksite: Worksite;
  attendance: AttendanceRecord[];
  leaves: LeaveRequest[];
  holidays: string[];
};

/** Supabase 없이 라우트를 검증하기 위한 저장소. 정렬·조건은 실제 구현과 같게 맞춘다. */
export function createMemoryRepo(data: MemoryData): Repo {
  return {
    async findEmployeeByNo(employeeNo) {
      return data.employees.find((item) => item.employeeNo === employeeNo) ?? null;
    },
    async findEmployeeById(id) {
      return data.employees.find((item) => item.id === id) ?? null;
    },

    async getWorksite() {
      return data.worksite;
    },
    async updateWorksite(_id, patch) {
      data.worksite = { ...data.worksite, ...patch };
      return data.worksite;
    },

    async findAttendance(employeeId, workDate) {
      return (
        data.attendance.find(
          (item) => item.employeeId === employeeId && item.workDate === workDate,
        ) ?? null
      );
    },
    async listAttendance(employeeId, from, to) {
      return data.attendance
        .filter(
          (item) => item.employeeId === employeeId && item.workDate >= from && item.workDate <= to,
        )
        .sort((a, b) => b.workDate.localeCompare(a.workDate));
    },
    async insertAttendance(record) {
      if (await this.findAttendance(record.employeeId, record.workDate)) return null;
      const created = { ...record, id: randomUUID() };
      data.attendance.push(created);
      return created;
    },
    async closeAttendance(id, patch) {
      const found = data.attendance.find((item) => item.id === id && !item.checkOutAt);
      if (!found) return null;
      Object.assign(found, patch);
      return found;
    },

    async findLeave(id) {
      return data.leaves.find((item) => item.id === id) ?? null;
    },
    async listLeaves(employeeId, from, to) {
      return data.leaves
        .filter(
          (item) => item.employeeId === employeeId && item.endDate >= from && item.startDate <= to,
        )
        .sort(
          (a, b) =>
            b.startDate.localeCompare(a.startDate) || b.requestedAt.localeCompare(a.requestedAt),
        );
    },
    async listPendingLeaves(department) {
      return data.leaves
        .filter((item) => item.department === department && item.status === 'pending')
        .sort((a, b) => a.startDate.localeCompare(b.startDate));
    },
    async insertLeave(leave) {
      const created = { ...leave, id: randomUUID() };
      data.leaves.push(created);
      return created;
    },
    async transitionLeave(id, from, patch) {
      const found = data.leaves.find((item) => item.id === id && from.includes(item.status));
      if (!found) return null;
      Object.assign(found, patch);
      return found;
    },

    async listHolidays(from, to) {
      return data.holidays.filter((date) => date >= from && date <= to);
    },
  };
}
