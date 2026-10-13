import { randomUUID } from 'node:crypto';

import type { Company, EmployeeRow, NewEmployee, Repo } from '../src/repo/types.ts';
import type { AttendanceRecord, LeaveRequest, Worksite } from '../src/types.ts';

export type MemoryData = {
  companies: (Company & { nameKey: string })[];
  employees: EmployeeRow[];
  /** 회사 id → 근무지 */
  worksites: Record<string, Worksite>;
  attendance: AttendanceRecord[];
  leaves: LeaveRequest[];
  holidays: string[];
};

/** Supabase 없이 라우트를 검증하기 위한 저장소. 정렬·조건은 실제 구현과 같게 맞춘다. */
export const DEFAULT_WORKSITE: Omit<Worksite, 'id'> = {
  name: '본사',
  latitude: 37.5666805,
  longitude: 126.9784147,
  radiusMeters: 200,
  startHour: 9,
  startMinute: 0,
  endHour: 18,
  endMinute: 0,
};

export function createMemoryRepo(data: MemoryData): Repo {
  const companyOf = (employeeId: string) =>
    data.employees.find((item) => item.id === employeeId)?.companyId;

  const addEmployee = (company: Company, employee: NewEmployee, role: EmployeeRow['role']) => {
    const created: EmployeeRow = {
      ...employee,
      id: randomUUID(),
      companyId: company.id,
      companyName: company.name,
      role,
      hiredAt: employee.hiredAt ?? '2026-10-06',
      annualLeaveDays: null,
      active: true,
    };
    data.employees.push(created);
    return created;
  };

  return {
    async findCompany(nameKey) {
      return data.companies.find((item) => item.nameKey === nameKey) ?? null;
    },
    async createCompany(name, nameKey, owner) {
      if (await this.findCompany(nameKey)) return null;
      const company = { id: randomUUID(), name, nameKey };
      data.companies.push(company);
      data.worksites[company.id] = { ...DEFAULT_WORKSITE, id: randomUUID() };
      return addEmployee(company, owner, 'manager');
    },
    async insertEmployee(companyId, employee) {
      if (await this.findEmployeeByNo(companyId, employee.employeeNo)) return null;
      const company = data.companies.find((item) => item.id === companyId)!;
      return addEmployee(company, employee, employee.role ?? 'member');
    },

    async findEmployeeByNo(companyId, employeeNo) {
      return (
        data.employees.find(
          (item) => item.companyId === companyId && item.employeeNo === employeeNo,
        ) ?? null
      );
    },
    async findEmployeeById(id) {
      return data.employees.find((item) => item.id === id) ?? null;
    },
    async listEmployees(companyId) {
      return data.employees
        .filter((item) => item.companyId === companyId)
        .sort((a, b) => a.employeeNo.localeCompare(b.employeeNo));
    },
    async updateEmployee(id, patch) {
      const found = data.employees.find((item) => item.id === id)!;
      Object.assign(found, patch);
      return found;
    },

    async getWorksite(companyId) {
      return data.worksites[companyId];
    },
    async updateWorksite(id, patch) {
      const companyId = Object.keys(data.worksites).find((key) => data.worksites[key].id === id)!;
      data.worksites[companyId] = { ...data.worksites[companyId], ...patch };
      return data.worksites[companyId];
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
    async listCompanyAttendance(companyId, from, to, employeeId) {
      return data.attendance
        .filter(
          (item) =>
            companyOf(item.employeeId) === companyId &&
            (employeeId === undefined || item.employeeId === employeeId) &&
            item.workDate >= from &&
            item.workDate <= to,
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

    async findLeave(id, companyId) {
      return (
        data.leaves.find((item) => item.id === id && companyOf(item.employeeId) === companyId) ??
        null
      );
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
    async listCompanyLeaves(companyId, filter = {}) {
      return data.leaves
        .filter(
          (item) =>
            companyOf(item.employeeId) === companyId &&
            (!filter.from || item.endDate >= filter.from) &&
            (!filter.to || item.startDate <= filter.to) &&
            (!filter.status || item.status === filter.status),
        )
        .sort(
          (a, b) =>
            b.startDate.localeCompare(a.startDate) || b.requestedAt.localeCompare(a.requestedAt),
        );
    },
    async listPendingLeaves(companyId, department) {
      return data.leaves
        .filter(
          (item) =>
            companyOf(item.employeeId) === companyId &&
            item.department === department &&
            item.status === 'pending',
        )
        .sort((a, b) => a.startDate.localeCompare(b.startDate));
    },
    async insertLeave(_companyId, leave) {
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
