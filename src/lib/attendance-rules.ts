import type { AttendanceRecord, AttendanceStatus, LeaveRequest, Worksite } from '../types.ts';
import { scheduleMinutes } from './leave-rules.ts';
import type { Clock } from './time.ts';

/** 지각/조기퇴근 판정 시 허용하는 여유 시간(분) */
export const GRACE_MINUTES = 5;

/**
 * 출퇴근 시각과 근무지 규정을 비교해 근태 상태를 계산한다.
 * 그날 승인된 반차·시차가 출근이나 퇴근 시각에 붙어 있으면 그만큼 예정 시각을 옮긴다.
 */
export function resolveStatus(
  record: Pick<AttendanceRecord, 'workDate' | 'checkInAt' | 'checkOutAt'>,
  worksite: Worksite,
  dayLeaves: readonly Pick<LeaveRequest, 'type' | 'startTime' | 'endTime'>[],
  clock: Clock,
): AttendanceStatus {
  if (!record.checkOutAt) {
    // 오늘 근무일이면 아직 근무 중, 지난 날짜면 퇴근 미체크
    return record.workDate === clock.today() ? 'working' : 'missingCheckOut';
  }

  // 하루를 통째로 쉬는 날 나와서 일했다면 지각·조퇴를 따지지 않는다.
  const schedule = scheduleMinutes(worksite, dayLeaves);
  if (!schedule) return 'normal';

  const checkIn = clock.minutesSince(record.workDate, record.checkInAt);
  const checkOut = clock.minutesSince(record.workDate, record.checkOutAt);
  const isLate = Math.round(checkIn - schedule.start) > GRACE_MINUTES;
  const isEarlyLeave = Math.round(schedule.end - checkOut) > GRACE_MINUTES;

  if (isLate && isEarlyLeave) return 'lateAndEarlyLeave';
  if (isLate) return 'late';
  if (isEarlyLeave) return 'earlyLeave';
  return 'normal';
}
