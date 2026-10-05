import type {
  AttendanceRecord,
  Employee,
  LeaveRequest,
  LeaveStatus,
  Worksite,
} from '../types.ts';

/** 응답으로 나가는 Employee 에 서버만 아는 인사 정보를 더한 것 */
export type EmployeeRow = Required<Employee> & {
  passwordHash: string;
  /** 입사일 (YYYY-MM-DD). 연차 부여 일수의 기준 */
  hiredAt: string;
  /** 따로 정한 연간 연차. null 이면 근속연수로 계산한다. */
  annualLeaveDays: number | null;
  active: boolean;
};

export type WorksitePatch = Partial<Omit<Worksite, 'id'>>;

/** 저장소. 실서버는 Supabase, 테스트는 메모리 구현을 쓴다. */
export interface Repo {
  findEmployeeByNo(employeeNo: string): Promise<EmployeeRow | null>;
  findEmployeeById(id: string): Promise<EmployeeRow | null>;

  getWorksite(): Promise<Worksite>;
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

  findLeave(id: string): Promise<LeaveRequest | null>;
  /** 기간과 겹치는 신청. 시작일 최신순 */
  listLeaves(employeeId: string, from: string, to: string): Promise<LeaveRequest[]>;
  /** 부서의 결재 대기 신청. 시작일이 가까운 순 */
  listPendingLeaves(department: string): Promise<LeaveRequest[]>;
  insertLeave(leave: Omit<LeaveRequest, 'id'>): Promise<LeaveRequest>;
  /** 상태가 from 중 하나일 때만 바꾼다. 그 사이 다른 요청이 먼저 처리했으면 null */
  transitionLeave(
    id: string,
    from: readonly LeaveStatus[],
    patch: Pick<LeaveRequest, 'status'> & Partial<Pick<LeaveRequest, 'decidedAt' | 'decidedBy'>>,
  ): Promise<LeaveRequest | null>;

  /** 기간 내 공휴일 날짜 (YYYY-MM-DD) */
  listHolidays(from: string, to: string): Promise<string[]>;
}
