/**
 * 초기 데이터.
 *
 *   npm run seed            직원 계정 + 공휴일
 *   npm run seed -- --demo  위에 더해 지난 근태 기록과 휴가 신청 예시까지
 *
 * 여러 번 돌려도 이미 있는 줄은 건드리지 않는다. (비밀번호도 덮어쓰지 않는다.)
 */
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';

import { loadEnv } from '../src/env.ts';
import { resolveStatus } from '../src/lib/attendance-rules.ts';
import { countLeaveDays, workEndMinutes, workStartMinutes } from '../src/lib/leave-rules.ts';
import { addDays, createClock, isWeekend, minutesBetween } from '../src/lib/time.ts';
import { createSupabaseRepo } from '../src/repo/supabase.ts';
import type { LeaveType } from '../src/types.ts';

const env = loadEnv();
const db = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const repo = createSupabaseRepo(env.supabaseUrl, env.supabaseServiceRoleKey);
const clock = createClock(env.timeZone);

/** 데모 계정. 비밀번호는 모두 1234 — 운영 전에 반드시 바꾼다. */
const EMPLOYEES = [
  { employee_no: '1001', name: '김민준', department: '개발팀', position: '팀장', role: 'manager', hired_at: '2019-03-04' },
  { employee_no: '1002', name: '이서연', department: '개발팀', position: '사원', role: 'member', hired_at: '2024-01-02' },
  { employee_no: '2000', name: '최수아', department: '영업팀', position: '팀장', role: 'manager', hired_at: '2017-09-01' },
  { employee_no: '2001', name: '박지호', department: '영업팀', position: '대리', role: 'member', hired_at: '2021-07-01' },
];

/** 평일에 걸리는 공휴일만. 음력 명절·임시공휴일은 해마다 holidays 테이블에 직접 넣는다. */
const HOLIDAYS = [
  { date: '2026-10-09', name: '한글날' },
  { date: '2026-12-25', name: '성탄절' },
  { date: '2027-01-01', name: '신정' },
  { date: '2027-03-01', name: '삼일절' },
  { date: '2027-05-05', name: '어린이날' },
  { date: '2027-08-16', name: '광복절 대체공휴일' },
  { date: '2027-10-04', name: '개천절 대체공휴일' },
  { date: '2027-10-11', name: '한글날 대체공휴일' },
  { date: '2027-12-27', name: '성탄절 대체공휴일' },
];

function ok<T>(result: { data: T; error: { message: string } | null }) {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

/** 날짜별로 항상 같은 값이 나오는 간단한 해시 (데모 데이터 재현성 확보용) */
function pseudoRandom(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 100_000;
  }
  return hash / 100_000;
}

async function seedBase() {
  const passwordHash = await bcrypt.hash('1234', 10);
  ok(
    await db.from('employees').upsert(
      EMPLOYEES.map((item) => ({ ...item, password_hash: passwordHash })),
      { onConflict: 'employee_no', ignoreDuplicates: true },
    ),
  );
  ok(await db.from('holidays').upsert(HOLIDAYS, { onConflict: 'date', ignoreDuplicates: true }));
  console.log(`직원 ${EMPLOYEES.length}명, 공휴일 ${HOLIDAYS.length}일 확인`);
}

/** 지난 영업일 12일분의 근태 기록. 대부분 정상, 일부는 지각·조기퇴근 */
async function seedAttendance(employees: { id: string }[], holidays: Set<string>) {
  const worksite = await repo.getWorksite();
  const location = { latitude: worksite.latitude, longitude: worksite.longitude };
  const rows = [];

  for (const { id } of employees) {
    let workDate = clock.today();
    for (let count = 0; count < 12; ) {
      workDate = addDays(workDate, -1);
      if (isWeekend(workDate) || holidays.has(workDate)) continue;
      count += 1;

      const noise = pseudoRandom(`${id}:${workDate}`);
      const checkInOffset = noise > 0.85 ? 18 : Math.round((noise - 0.5) * 20);
      const checkOutOffset = noise < 0.12 ? -35 : Math.round((noise - 0.4) * 60);
      const times = {
        workDate,
        checkInAt: clock
          .instantAt(workDate, workStartMinutes(worksite) + checkInOffset)
          .toISOString(),
        checkOutAt: clock
          .instantAt(workDate, workEndMinutes(worksite) + checkOutOffset)
          .toISOString(),
      };

      rows.push({
        employee_id: id,
        work_date: workDate,
        check_in_at: times.checkInAt,
        check_in_location: location,
        check_out_at: times.checkOutAt,
        check_out_location: location,
        worked_minutes: minutesBetween(times.checkInAt, times.checkOutAt),
        status: resolveStatus(times, worksite, [], clock),
      });
    }
  }

  ok(
    await db
      .from('attendance_records')
      .upsert(rows, { onConflict: 'employee_id,work_date', ignoreDuplicates: true }),
  );
  console.log(`근태 기록 ${rows.length}건 확인`);
}

/** 팀장(1001)에게는 결재할 거리를, 팀원(1002)에게는 대기·승인 상태를 모두 보여 준다. */
async function seedLeaves(
  employees: { id: string; employee_no: string; name: string; department: string; role: string }[],
  holidays: Set<string>,
) {
  const { count } = await db.from('leave_requests').select('id', { count: 'exact', head: true });
  if (count) {
    console.log('휴가 신청이 이미 있어 예시를 넣지 않습니다.');
    return;
  }

  /** 오늘부터 n번째 근무일 */
  const workdayAhead = (n: number) => {
    let date = clock.today();
    for (let left = n; left > 0; ) {
      date = addDays(date, 1);
      if (!isWeekend(date) && !holidays.has(date)) left -= 1;
    }
    return date;
  };

  const requestedAt = new Date().toISOString();
  const make = (
    employeeNo: string,
    type: LeaveType,
    startOffset: number,
    endOffset: number,
    reason: string,
    approved: boolean,
    time?: { start: string; end: string; hours: number },
  ) => {
    const employee = employees.find((item) => item.employee_no === employeeNo)!;
    const manager = employees.find(
      (item) => item.role === 'manager' && item.department === employee.department,
    );
    const startDate = workdayAhead(startOffset);
    const endDate = workdayAhead(endOffset);
    return {
      employee_id: employee.id,
      employee_name: employee.name,
      department: employee.department,
      type,
      start_date: startDate,
      end_date: endDate,
      start_time: time?.start ?? null,
      end_time: time?.end ?? null,
      days: countLeaveDays(type, startDate, endDate, time?.hours ?? null, holidays),
      reason,
      status: approved ? 'approved' : 'pending',
      requested_at: requestedAt,
      decided_at: approved ? requestedAt : null,
      decided_by: approved ? (manager?.name ?? null) : null,
    };
  };

  const rows = [
    make('1002', 'halfPm', 3, 3, '병원 진료', true),
    make('1002', 'annual', 8, 9, '가족 여행', false),
    make('1002', 'hourly', 5, 5, '은행 업무', false, { start: '16:00', end: '18:00', hours: 2 }),
    make('1001', 'annual', 12, 12, '개인 용무', true),
    make('2001', 'annual', 5, 6, '이사', false),
  ];
  ok(await db.from('leave_requests').insert(rows));
  console.log(`휴가 신청 ${rows.length}건 추가`);
}

await seedBase();

if (process.argv.includes('--demo')) {
  const employees = ok(
    await db
      .from('employees')
      .select('id, employee_no, name, department, role')
      .in('employee_no', EMPLOYEES.map((item) => item.employee_no)),
  )!;
  const holidays = new Set(await repo.listHolidays('2000-01-01', '2100-12-31'));

  await seedAttendance(employees, holidays);
  await seedLeaves(employees, holidays);
}
