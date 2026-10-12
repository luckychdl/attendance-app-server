import type {
  AttendanceRecord,
  Employee,
  LeaveRequest,
  LeaveStatus,
  Worksite,
} from '../types.ts';

/** 응답으로 나가는 Employee 에 서버만 아는 인사 정보를 더한 것 */
export type EmployeeRow = Required<Employee> & {
  companyId: string;
  passwordHash: string;
  /** 입사일 (YYYY-MM-DD). 연차 부여 일수의 기준 */
  hiredAt: string;
  /** 따로 정한 연간 연차. null 이면 근속연수로 계산한다. */
  annualLeaveDays: number | null;
  active: boolean;
};

export type Company = { id: string; name: string };

/** 가입할 때 받는 인사 정보 */
export type NewEmployee = Pick<EmployeeRow, 'employeeNo' | 'name' | 'department' | 'position'> & {
  passwordHash: string;
};

export type WorksitePatch = Partial<Omit<Worksite, 'id'>>;

/** 저장소. 실서버는 Supabase, 테스트는 메모리 구현을 쓴다. */
export interface Repo {
  /** nameKey 는 companyKey() 로 다듬은 회사 이름 */
  findCompany(nameKey: string): Promise<Company | null>;
  /**
   * 회사 · 기본 근무지 · 첫 직원(manager)을 한 번에 만든다.
   * 그 사이 같은 이름의 회사가 먼저 생겼으면 null
   */
  createCompany(name: string, nameKey: string, owner: NewEmployee): Promise<EmployeeRow | null>;
  /** 이미 있는 회사에 팀원으로 추가한다. 그 회사에 같은 사번이 있으면 null */
  insertEmployee(companyId: string, employee: NewEmployee): Promise<EmployeeRow | null>;

  findEmployeeByNo(companyId: string, employeeNo: string): Promise<EmployeeRow | null>;
  findEmployeeById(id: string): Promise<EmployeeRow | null>;

  getWorksite(companyId: string): Promise<Worksite>;
  updateWorksite(id: string, patch: WorksitePatch): Promise<Worksite>;

  findAttendance(employeeId: string, workDate: string): Promise<AttendanceRecord | null>;
  /** 기간 내 기록. 근무일 최신순 */
  listAttendance(employeeId: string, from: string, to: string): Promise<AttendanceRecord[]>;
  /** 같은 날 기록이 이미 있으면 null */
  insertAttendance(record: Omit<AttendanceRecord, 'id'>): Promise<AttendanceRecord | null>;
  /** 퇴근 처리. 이미 퇴근한 기록이면 null */
  closeAttendance(
    id: string,
    patch: Pick<
      AttendanceRecord,
      'checkOutAt' | 'checkOutLocation' | 'workedMinutes' | 'status' | 'note'
    >,
  ): Promise<AttendanceRecord | null>;

  /** 다른 회사의 신청은 없는 것으로 본다. */
  findLeave(id: string, companyId: string): Promise<LeaveRequest | null>;
  /** 기간과 겹치는 신청. 시작일 최신순 */
  listLeaves(employeeId: string, from: string, to: string): Promise<LeaveRequest[]>;
  /** 회사 안 한 부서의 결재 대기 신청. 시작일이 가까운 순 */
  listPendingLeaves(companyId: string, department: string): Promise<LeaveRequest[]>;
  insertLeave(companyId: string, leave: Omit<LeaveRequest, 'id'>): Promise<LeaveRequest>;
  /** 상태가 from 중 하나일 때만 바꾼다. 그 사이 다른 요청이 먼저 처리했으면 null */
  transitionLeave(
    id: string,
    from: readonly LeaveStatus[],
    patch: Pick<LeaveRequest, 'status'> & Partial<Pick<LeaveRequest, 'decidedAt' | 'decidedBy'>>,
  ): Promise<LeaveRequest | null>;

  /** 기간 내 공휴일 날짜 (YYYY-MM-DD) */
  listHolidays(from: string, to: string): Promise<string[]>;
}
