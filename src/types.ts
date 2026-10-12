/** 도메인 타입. 앱(attendance-app/src/api/types.ts)과 1:1로 맞춘다. */

export type GeoPoint = {
  latitude: number;
  longitude: number;
  /** 미터 단위 위치 정확도. 기기가 제공하지 않으면 null */
  accuracy?: number | null;
};

export type Employee = {
  id: string;
  /** 사번 */
  employeeNo: string;
  name: string;
  department: string;
  position: string;
  /** manager 는 같은 부서의 휴가 신청을 결재한다. 구버전 세션에는 없을 수 있다. */
  role?: EmployeeRole;
  /** 소속 회사 이름. 구버전 세션에는 없을 수 있다. */
  companyName?: string;
};

export type EmployeeRole = 'member' | 'manager';

export type Session = {
  employee: Employee;
  token: string;
};

/** 근무지(사업장). 출퇴근 체크 가능 반경의 기준점 */
export type Worksite = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  /** 출퇴근 체크를 허용하는 반경(미터) */
  radiusMeters: number;
  /** 근무 시작 시각 (0~23) */
  startHour: number;
  startMinute: number;
  /** 근무 종료 시각 (0~23) */
  endHour: number;
  endMinute: number;
};

export type AttendanceStatus =
  | 'working' // 출근만 한 상태
  | 'normal' // 정상 출퇴근
  | 'late' // 지각
  | 'earlyLeave' // 조기 퇴근
  | 'lateAndEarlyLeave'
  | 'missingCheckOut'; // 퇴근 미체크

export type AttendanceRecord = {
  id: string;
  employeeId: string;
  /** 근무일 (YYYY-MM-DD) */
  workDate: string;
  /** ISO 8601 */
  checkInAt: string;
  checkInLocation: GeoPoint | null;
  /** ISO 8601. 퇴근 전이면 null */
  checkOutAt: string | null;
  checkOutLocation: GeoPoint | null;
  /** 근무 시간(분). 퇴근 전이면 null */
  workedMinutes: number | null;
  status: AttendanceStatus;
  /** 비고 (반경 밖 체크 등 예외 사유) */
  note: string | null;
};

export type CheckInput = {
  employeeId: string;
  location: GeoPoint | null;
  /** 근무지 반경 밖에서 체크한 경우 사유 */
  note?: string | null;
};

export type MonthlySummary = {
  /** YYYY-MM */
  month: string;
  workedDays: number;
  lateDays: number;
  earlyLeaveDays: number;
  totalWorkedMinutes: number;
};

export type LeaveType =
  | 'annual' // 연차 (하루)
  | 'halfAm' // 오전 반차
  | 'halfPm' // 오후 반차
  | 'hourly'; // 시차 (2시간 단위)

export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export type LeaveRequest = {
  id: string;
  employeeId: string;
  /** 결재 목록에서 보여 줄 신청자 정보 (신청 시점 기준) */
  employeeName: string;
  department: string;
  type: LeaveType;
  /** YYYY-MM-DD. 반차·시차는 startDate 와 endDate 가 같다. */
  startDate: string;
  endDate: string;
  /** 시차의 시작·종료 시각 (HH:mm). 점심시간을 끼면 그만큼 뒤로 밀린다. 시차가 아니면 null */
  startTime: string | null;
  endTime: string | null;
  /** 차감 일수. 주말은 빠지고 반차는 0.5, 시차는 시간 ÷ 8 */
  days: number;
  reason: string | null;
  status: LeaveStatus;
  /** ISO 8601 */
  requestedAt: string;
  /** ISO 8601. 결재(승인/반려) 전이면 null */
  decidedAt: string | null;
  /** 결재자 이름 */
  decidedBy: string | null;
};

export type LeaveInput = {
  employeeId: string;
  type: LeaveType;
  startDate: string;
  endDate: string;
  /** 시차만. 시작 시각 (HH:mm) */
  startTime?: string | null;
  /** 시차만. 2·4·6 시간 */
  hours?: number | null;
  reason?: string | null;
};

/** 연간 연차 현황 */
export type LeaveBalance = {
  year: number;
  /** 부여 일수 */
  granted: number;
  /** 승인되어 차감된 일수 */
  used: number;
  /** 결재 대기 중인 일수 */
  pending: number;
  /** granted - used - pending */
  remaining: number;
};
