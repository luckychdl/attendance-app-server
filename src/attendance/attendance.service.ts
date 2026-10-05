import { Inject, Injectable } from '@nestjs/common';

import { badRequest, conflict } from '../common/errors.ts';
import { CLOCK, REPO } from '../common/tokens.ts';
import { resolveStatus } from '../lib/attendance-rules.ts';
import { distanceInMeters } from '../lib/geo.ts';
import { type Clock, minutesBetween, monthRange } from '../lib/time.ts';
import type { Repo } from '../repo/types.ts';
import type { AttendanceRecord, GeoPoint, MonthlySummary, Worksite } from '../types.ts';

export type CheckContext = {
  location: GeoPoint | null;
  /** 근무지 반경 밖에서 체크한 경우 사유 */
  note?: string | null;
};

/**
 * 근무지 반경 밖이거나 위치를 못 받았으면 사유가 있어야 기록한다.
 * 앱도 같은 조건으로 버튼을 막지만, 요청을 직접 보내면 우회할 수 있어 서버에서 다시 본다.
 */
function requireNoteIfOutside(input: CheckContext, worksite: Worksite) {
  const note = input.note || null;
  const inside =
    input.location != null &&
    distanceInMeters(input.location, worksite) <= worksite.radiusMeters;
  if (!inside && !note) {
    throw badRequest('근무지 반경 밖입니다. 사유를 남기고 기록해 주세요.');
  }
  return note;
}

@Injectable()
export class AttendanceService {
  constructor(
    @Inject(REPO) private readonly repo: Repo,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** 퇴근 전 기록은 읽는 날짜에 따라 근무중 ↔ 퇴근 미체크가 갈린다. */
  private present(record: AttendanceRecord): AttendanceRecord {
    if (record.checkOutAt) return record;
    return {
      ...record,
      status: record.workDate === this.clock.today() ? 'working' : 'missingCheckOut',
    };
  }

  /** 오늘자 근태 기록. 아직 출근하지 않았으면 null */
  async today(employeeId: string) {
    const record = await this.repo.findAttendance(employeeId, this.clock.today());
    return record ? this.present(record) : null;
  }

  /** 기간(YYYY-MM-DD) 내 근태 기록. 최신순 */
  async list(employeeId: string, from: string, to: string) {
    const records = await this.repo.listAttendance(employeeId, from, to);
    return records.map((record) => this.present(record));
  }

  /** 월간 집계 (YYYY-MM) */
  async summary(employeeId: string, month: string): Promise<MonthlySummary> {
    const { from, to } = monthRange(month);
    const records = await this.list(employeeId, from, to);

    return {
      month,
      workedDays: records.length,
      lateDays: records.filter((r) => r.status === 'late' || r.status === 'lateAndEarlyLeave')
        .length,
      earlyLeaveDays: records.filter(
        (r) => r.status === 'earlyLeave' || r.status === 'lateAndEarlyLeave',
      ).length,
      totalWorkedMinutes: records.reduce((sum, r) => sum + (r.workedMinutes ?? 0), 0),
    };
  }

  async checkIn(employeeId: string, input: CheckContext) {
    const note = requireNoteIfOutside(input, await this.repo.getWorksite());
    const now = this.clock.now();

    const created = await this.repo.insertAttendance({
      employeeId,
      workDate: this.clock.zoned(now).dateKey,
      checkInAt: now.toISOString(),
      checkInLocation: input.location,
      checkOutAt: null,
      checkOutLocation: null,
      workedMinutes: null,
      status: 'working',
      note,
    });
    if (!created) throw conflict('오늘은 이미 출근 체크를 완료했습니다.');
    return created;
  }

  async checkOut(employeeId: string, input: CheckContext) {
    const alreadyDone = '오늘은 이미 퇴근 체크를 완료했습니다.';
    const now = this.clock.now();
    const today = this.clock.zoned(now).dateKey;

    const existing = await this.repo.findAttendance(employeeId, today);
    if (!existing) {
      throw conflict('출근 체크 기록이 없습니다. 먼저 출근 체크를 해주세요.');
    }
    if (existing.checkOutAt) throw conflict(alreadyDone);

    const worksite = await this.repo.getWorksite();
    const note = requireNoteIfOutside(input, worksite);
    const checkOutAt = now.toISOString();

    // 그날 승인된 반차·시차가 있으면 판정 기준 시각이 달라진다.
    const dayLeaves = (await this.repo.listLeaves(employeeId, today, today)).filter(
      (leave) => leave.status === 'approved',
    );

    const updated = await this.repo.closeAttendance(existing.id, {
      checkOutAt,
      checkOutLocation: input.location,
      workedMinutes: minutesBetween(existing.checkInAt, now),
      status: resolveStatus({ ...existing, checkOutAt }, worksite, dayLeaves, this.clock),
      note: note ?? existing.note,
    });
    if (!updated) throw conflict(alreadyDone);
    return updated;
  }
}
