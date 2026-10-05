import type { LeaveBalance, LeaveRequest, LeaveType, Worksite } from '../types.ts';
import { datesInRange, isWeekend, parseClock } from './time.ts';

/** 연차 하루를 몇 시간으로 치는지. 시차 차감의 기준이다. */
export const WORK_HOURS_PER_DAY = 8;

/** 시차는 2시간 단위로 쓴다. */
export const HOURLY_LEAVE_HOURS = [2, 4, 6] as const;

/** 점심시간(자정 기준 분). 근무로 치지 않으므로 시차가 이 구간을 끼면 끝나는 시각이 한 시간 밀린다. */
export const LUNCH = { start: 12 * 60, end: 13 * 60 } as const;

export const LEAVE_TYPE_LABEL: Record<LeaveType, string> = {
  annual: '연차',
  halfAm: '오전 반차',
  halfPm: '오후 반차',
  hourly: '시차',
};

/** 반차와 시차는 하루 안에서 끝난다. */
export function isSingleDay(type: LeaveType) {
  return type !== 'annual';
}

/** 아직 살아 있는 신청. 잔여 일수를 잡아먹고 다른 신청과 겹치면 안 된다. */
export function isActive(leave: Pick<LeaveRequest, 'status'>) {
  return leave.status === 'pending' || leave.status === 'approved';
}

// ─── 부여 일수 ────────────────────────────────────────────────

/**
 * 그 해에 부여되는 연차. 달력 연도(회계연도) 단위로 끊어 근속연수를 센다.
 * - 입사한 해: 한 달을 채울 때마다 1일, 최대 11일
 * - 이듬해부터: 15일, 이후 2년마다 1일씩 늘어 최대 25일
 * 직원에게 따로 정한 일수(annualLeaveDays)가 있으면 그 값을 쓴다.
 */
export function grantedDays(
  employee: { hiredAt: string; annualLeaveDays: number | null },
  year: number,
) {
  if (employee.annualLeaveDays != null) return employee.annualLeaveDays;

  const [hiredYear, hiredMonth, hiredDay] = employee.hiredAt.split('-').map(Number);
  const years = year - hiredYear;
  if (years < 0) return 0;
  if (years === 0) return Math.min(11, 12 - hiredMonth + (hiredDay === 1 ? 1 : 0));
  return Math.min(25, 15 + Math.floor((years - 1) / 2));
}

/** 잔여 = 부여 − 승인 − 결재 대기. 시작일이 그 해에 속한 신청만 센다. */
export function computeBalance(
  leaves: readonly Pick<LeaveRequest, 'startDate' | 'status' | 'days'>[],
  year: number,
  granted: number,
): LeaveBalance {
  const mine = leaves.filter((item) => item.startDate.startsWith(`${year}-`));
  const sum = (status: LeaveRequest['status']) =>
    mine.filter((item) => item.status === status).reduce((total, item) => total + item.days, 0);

  const used = sum('approved');
  const pending = sum('pending');
  return { year, granted, used, pending, remaining: granted - used - pending };
}

// ─── 근무 시간 계산 ───────────────────────────────────────────

export function workStartMinutes(worksite: Worksite) {
  return worksite.startHour * 60 + worksite.startMinute;
}

export function workEndMinutes(worksite: Worksite) {
  return worksite.endHour * 60 + worksite.endMinute;
}

/** from ~ to 사이에서 점심시간을 뺀 근무 분 */
function workMinutesBetween(from: number, to: number) {
  const lunch = Math.max(0, Math.min(to, LUNCH.end) - Math.max(from, LUNCH.start));
  return to - from - lunch;
}

/** from 에서 근무 minutes 분이 지난 시각. 점심시간은 건너뛴다. */
export function addWorkMinutes(from: number, minutes: number) {
  let at = from >= LUNCH.start && from < LUNCH.end ? LUNCH.end : from;
  let left = minutes;
  if (at < LUNCH.start && at + left > LUNCH.start) {
    left -= LUNCH.start - at;
    at = LUNCH.end;
  }
  return at + left;
}

/**
 * 반차의 경계 시각. 하루 근무의 딱 절반이 지난 때다.
 * 09:00–18:00 이면 점심을 빼고 4시간이 지난 14:00.
 */
export function halfDaySplitMinutes(worksite: Worksite) {
  const start = workStartMinutes(worksite);
  return addWorkMinutes(start, workMinutesBetween(start, workEndMinutes(worksite)) / 2);
}

export type TimeSlot = { start: number; end: number };

/**
 * 시차로 고를 수 있는 시간대. 정시에 시작하고, 점심시간에는 시작하지 않으며,
 * 퇴근 시각을 넘지 않는다. 09–18시 2시간이면 09·10·11·13·14·15·16시 시작.
 */
export function hourlySlots(worksite: Worksite, hours: number): TimeSlot[] {
  const slots: TimeSlot[] = [];
  const endOfDay = workEndMinutes(worksite);
  for (let start = workStartMinutes(worksite); start < endOfDay; start += 60) {
    if (start >= LUNCH.start && start < LUNCH.end) continue;
    const end = addWorkMinutes(start, hours * 60);
    if (end <= endOfDay) slots.push({ start, end });
  }
  return slots;
}

// ─── 차감과 겹침 ──────────────────────────────────────────────

/**
 * 차감 일수. 주말과 공휴일은 세지 않는다.
 * 반차는 0.5일, 시차는 시간 ÷ 8. 둘 다 근무일이어야 센다.
 */
export function countLeaveDays(
  type: LeaveType,
  startDate: string,
  endDate: string,
  hours: number | null = null,
  holidays: ReadonlySet<string> = new Set(),
) {
  const workdays = datesInRange(startDate, endDate).filter(
    (key) => !isWeekend(key) && !holidays.has(key),
  ).length;
  if (type === 'annual') return workdays;
  const onWorkday = Math.min(workdays, 1);
  if (type === 'hourly') return (onWorkday * (hours ?? 0)) / WORK_HOURS_PER_DAY;
  return onWorkday * 0.5;
}

type Occupancy = Pick<LeaveRequest, 'type' | 'startDate' | 'endDate' | 'startTime' | 'endTime'>;

/** 휴가가 하루 중 차지하는 시간대(자정 기준 분). 연차는 하루 전체다. */
export function leaveWindow(
  leave: Pick<Occupancy, 'type' | 'startTime' | 'endTime'>,
  worksite: Worksite,
): TimeSlot {
  switch (leave.type) {
    case 'halfAm':
      return { start: workStartMinutes(worksite), end: halfDaySplitMinutes(worksite) };
    case 'halfPm':
      return { start: halfDaySplitMinutes(worksite), end: workEndMinutes(worksite) };
    case 'hourly':
      return leave.startTime && leave.endTime
        ? { start: parseClock(leave.startTime), end: parseClock(leave.endTime) }
        : { start: 0, end: 0 };
    case 'annual':
      return { start: 0, end: 24 * 60 };
  }
}

/** 두 신청이 같은 날 같은 시간을 차지하는지. 오전 반차와 오후 시차처럼 시간대가 다르면 함께 쓸 수 있다. */
export function overlaps(a: Occupancy, b: Occupancy, worksite: Worksite) {
  if (a.startDate > b.endDate || b.startDate > a.endDate) return false;
  const x = leaveWindow(a, worksite);
  const y = leaveWindow(b, worksite);
  return x.start < y.end && y.start < x.end;
}

/** 본인이 거둘 수 있는 신청. 승인된 건은 시작일 전까지만 취소할 수 있다. */
export function isCancellable(leave: Pick<LeaveRequest, 'status' | 'startDate'>, today: string) {
  if (leave.status === 'pending') return true;
  return leave.status === 'approved' && leave.startDate > today;
}

// ─── 근태 판정과의 연결 ───────────────────────────────────────

/**
 * 휴가를 뺀 그날의 예정 근무시간(자정 기준 분). 하루를 다 쉬면 null.
 * 출근 시각에 붙은 휴가는 시작을, 퇴근 시각에 붙은 휴가는 끝을 민다.
 * 오전 반차 + 16–18시 시차면 14:00–16:00 근무가 된다. 한낮의 시차는 출퇴근 기준을 바꾸지 않는다.
 */
export function scheduleMinutes(
  worksite: Worksite,
  dayLeaves: readonly Pick<Occupancy, 'type' | 'startTime' | 'endTime'>[] = [],
) {
  const windows = dayLeaves.map((leave) => leaveWindow(leave, worksite));
  let start = workStartMinutes(worksite);
  let end = workEndMinutes(worksite);

  let moved = true;
  while (moved && start < end) {
    moved = false;
    for (const window of windows) {
      if (window.start <= start && window.end > start) {
        start = window.end;
        moved = true;
      }
      if (window.end >= end && window.start < end) {
        end = window.start;
        moved = true;
      }
    }
    // 휴가가 점심시간 앞뒤에서 멈추면 점심을 건너 다음 근무 구간에 붙는다.
    if (start >= LUNCH.start && start < LUNCH.end) {
      start = LUNCH.end;
      moved = true;
    }
    if (end > LUNCH.start && end <= LUNCH.end) {
      end = LUNCH.start;
      moved = true;
    }
  }

  return start < end ? { start, end } : null;
}

/** 소수는 필요한 만큼만. 1 · 0.5 · 0.25 · 11.75 */
export function formatDays(days: number) {
  return String(Math.round(days * 1000) / 1000);
}
