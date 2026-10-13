import { createClient, type PostgrestError } from '@supabase/supabase-js';

import type { AttendanceRecord, LeaveRequest, Worksite } from '../types.ts';
import type { EmployeePatch, EmployeeRow, NewEmployee, Repo } from './types.ts';

type Row = Record<string, any>;

const UNIQUE_VIOLATION = '23505';

/** PostgREST 오류는 그대로 던져 500 으로 떨어뜨린다. 내용은 서버 로그에만 남는다. */
function check<T>(result: { data: T; error: PostgrestError | null }) {
  if (result.error) {
    throw new Error(`Supabase: ${result.error.message} (${result.error.code})`);
  }
  return result.data;
}

type Result<T> = { data: T | null; error: PostgrestError | null };

const one = (result: Result<Row>): Row => check(result)!;
const many = (result: Result<Row[]>): Row[] => check(result) ?? [];

/** uuid 컬럼에 다른 모양의 값을 넣으면 Postgres 가 오류를 내므로 조회 전에 거른다. */
const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/** PostgREST 는 한 번에 1000줄까지만 준다. 회사 전체 조회는 끝까지 이어 읽는다. */
const PAGE = 1000;
async function all(page: (from: number, to: number) => PromiseLike<Result<Row[]>>) {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const chunk = many(await page(from, from + PAGE - 1));
    rows.push(...chunk);
    if (chunk.length < PAGE) return rows;
  }
}

const iso = (value: string | null) => (value ? new Date(value).toISOString() : null);

function toEmployee(row: Row): EmployeeRow {
  return {
    id: row.id,
    companyId: row.company_id,
    companyName: row.companies.name,
    employeeNo: row.employee_no,
    name: row.name,
    department: row.department,
    position: row.position,
    role: row.role,
    passwordHash: row.password_hash,
    hiredAt: row.hired_at,
    annualLeaveDays: row.annual_leave_days == null ? null : Number(row.annual_leave_days),
    active: row.active,
  };
}

/** 직원을 읽을 때는 응답에 실을 회사 이름까지 함께 가져온다. */
const EMPLOYEE_SELECT = '*, companies(name)';

function toWorksite(row: Row): Worksite {
  return {
    id: row.id,
    name: row.name,
    latitude: row.latitude,
    longitude: row.longitude,
    radiusMeters: row.radius_meters,
    startHour: row.start_hour,
    startMinute: row.start_minute,
    endHour: row.end_hour,
    endMinute: row.end_minute,
  };
}

function toAttendance(row: Row): AttendanceRecord {
  return {
    id: row.id,
    employeeId: row.employee_id,
    workDate: row.work_date,
    checkInAt: iso(row.check_in_at)!,
    checkInLocation: row.check_in_location,
    checkOutAt: iso(row.check_out_at),
    checkOutLocation: row.check_out_location,
    workedMinutes: row.worked_minutes,
    status: row.status,
    note: row.note,
  };
}

function toLeave(row: Row): LeaveRequest {
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName: row.employee_name,
    department: row.department,
    type: row.type,
    startDate: row.start_date,
    endDate: row.end_date,
    startTime: row.start_time,
    endTime: row.end_time,
    days: Number(row.days),
    reason: row.reason,
    status: row.status,
    requestedAt: iso(row.requested_at)!,
    decidedAt: iso(row.decided_at),
    decidedBy: row.decided_by,
  };
}

const EMPLOYEE_COLUMNS = {
  name: 'name',
  department: 'department',
  position: 'position',
  role: 'role',
  hiredAt: 'hired_at',
  annualLeaveDays: 'annual_leave_days',
  active: 'active',
  passwordHash: 'password_hash',
} as const satisfies Record<keyof EmployeePatch, string>;

const WORKSITE_COLUMNS = {
  name: 'name',
  latitude: 'latitude',
  longitude: 'longitude',
  radiusMeters: 'radius_meters',
  startHour: 'start_hour',
  startMinute: 'start_minute',
  endHour: 'end_hour',
  endMinute: 'end_minute',
} as const;

export function createSupabaseRepo(url: string, serviceRoleKey: string): Repo {
  // service_role 키는 RLS 를 건너뛴다. 권한 검사는 전부 라우트에서 한다.
  const db = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return {
    async findCompany(nameKey) {
      const row = check(
        await db.from('companies').select('id, name').eq('name_key', nameKey).maybeSingle(),
      );
      return row ? { id: row.id, name: row.name } : null;
    },

    async createCompany(name, nameKey, owner) {
      const result = await db.rpc('create_company_with_owner', {
        p_company_name: name,
        p_company_key: nameKey,
        p_employee_no: owner.employeeNo,
        p_name: owner.name,
        p_department: owner.department,
        p_position: owner.position,
        p_password_hash: owner.passwordHash,
      });
      if (result.error?.code === UNIQUE_VIOLATION) return null;
      return this.findEmployeeById(check(result) as string);
    },

    async insertEmployee(companyId, employee: NewEmployee) {
      const result = await db
        .from('employees')
        .insert({
          company_id: companyId,
          employee_no: employee.employeeNo,
          name: employee.name,
          department: employee.department,
          position: employee.position,
          role: employee.role ?? 'member',
          password_hash: employee.passwordHash,
          ...(employee.hiredAt ? { hired_at: employee.hiredAt } : {}),
        })
        .select(EMPLOYEE_SELECT)
        .single();
      if (result.error?.code === UNIQUE_VIOLATION) return null;
      return toEmployee(one(result));
    },

    async findEmployeeByNo(companyId, employeeNo) {
      const row = check(
        await db
          .from('employees')
          .select(EMPLOYEE_SELECT)
          .eq('company_id', companyId)
          .eq('employee_no', employeeNo)
          .maybeSingle(),
      );
      return row ? toEmployee(row) : null;
    },

    async findEmployeeById(id) {
      if (!UUID.test(id)) return null;
      const row = check(
        await db.from('employees').select(EMPLOYEE_SELECT).eq('id', id).maybeSingle(),
      );
      return row ? toEmployee(row) : null;
    },

    async listEmployees(companyId) {
      const rows = await all((from, to) =>
        db
          .from('employees')
          .select(EMPLOYEE_SELECT)
          .eq('company_id', companyId)
          .order('employee_no')
          .order('id')
          .range(from, to),
      );
      return rows.map(toEmployee);
    },

    async updateEmployee(id, patch) {
      const values: Row = {};
      for (const [key, column] of Object.entries(EMPLOYEE_COLUMNS)) {
        const value = patch[key as keyof EmployeePatch];
        if (value !== undefined) values[column] = value;
      }
      return toEmployee(
        one(await db.from('employees').update(values).eq('id', id).select(EMPLOYEE_SELECT).single()),
      );
    },

    async getWorksite(companyId) {
      const row = check(
        await db.from('worksites').select().eq('company_id', companyId).maybeSingle(),
      );
      if (!row) throw new Error(`회사 ${companyId} 의 근무지가 없습니다.`);
      return toWorksite(row);
    },

    async updateWorksite(id, patch) {
      const values: Row = { updated_at: new Date().toISOString() };
      for (const [key, column] of Object.entries(WORKSITE_COLUMNS)) {
        const value = patch[key as keyof typeof WORKSITE_COLUMNS];
        if (value !== undefined) values[column] = value;
      }
      return toWorksite(
        one(await db.from('worksites').update(values).eq('id', id).select().single()),
      );
    },

    async findAttendance(employeeId, workDate) {
      const row = check(
        await db
          .from('attendance_records')
          .select()
          .eq('employee_id', employeeId)
          .eq('work_date', workDate)
          .maybeSingle(),
      );
      return row ? toAttendance(row) : null;
    },

    async listAttendance(employeeId, from, to) {
      const rows = many(
        await db
          .from('attendance_records')
          .select()
          .eq('employee_id', employeeId)
          .gte('work_date', from)
          .lte('work_date', to)
          .order('work_date', { ascending: false }),
      );
      return rows.map(toAttendance);
    },

    async listCompanyAttendance(companyId, from, to, employeeId) {
      if (employeeId !== undefined && !UUID.test(employeeId)) return [];
      const rows = await all((start, end) => {
        let query = db
          .from('attendance_records')
          .select('*, employees!inner(company_id)')
          .eq('employees.company_id', companyId)
          .gte('work_date', from)
          .lte('work_date', to);
        if (employeeId) query = query.eq('employee_id', employeeId);
        return query
          .order('work_date', { ascending: false })
          .order('id')
          .range(start, end);
      });
      return rows.map(toAttendance);
    },

    async insertAttendance(record) {
      const result = await db
        .from('attendance_records')
        .insert({
          employee_id: record.employeeId,
          work_date: record.workDate,
          check_in_at: record.checkInAt,
          check_in_location: record.checkInLocation,
          check_out_at: record.checkOutAt,
          check_out_location: record.checkOutLocation,
          worked_minutes: record.workedMinutes,
          status: record.status,
          note: record.note,
        })
        .select()
        .single();
      if (result.error?.code === UNIQUE_VIOLATION) return null;
      return toAttendance(one(result));
    },

    async closeAttendance(id, patch) {
      const row = check(
        await db
          .from('attendance_records')
          .update({
            check_out_at: patch.checkOutAt,
            check_out_location: patch.checkOutLocation,
            worked_minutes: patch.workedMinutes,
            status: patch.status,
            note: patch.note,
          })
          .eq('id', id)
          .is('check_out_at', null)
          .select()
          .maybeSingle(),
      );
      return row ? toAttendance(row) : null;
    },

    async findLeave(id, companyId) {
      const row = check(
        await db
          .from('leave_requests')
          .select()
          .eq('id', id)
          .eq('company_id', companyId)
          .maybeSingle(),
      );
      return row ? toLeave(row) : null;
    },

    async listLeaves(employeeId, from, to) {
      const rows = many(
        await db
          .from('leave_requests')
          .select()
          .eq('employee_id', employeeId)
          .gte('end_date', from)
          .lte('start_date', to)
          .order('start_date', { ascending: false })
          .order('requested_at', { ascending: false }),
      );
      return rows.map(toLeave);
    },

    async listCompanyLeaves(companyId, filter = {}) {
      const rows = await all((start, end) => {
        let query = db.from('leave_requests').select().eq('company_id', companyId);
        if (filter.from) query = query.gte('end_date', filter.from);
        if (filter.to) query = query.lte('start_date', filter.to);
        if (filter.status) query = query.eq('status', filter.status);
        return query
          .order('start_date', { ascending: false })
          .order('requested_at', { ascending: false })
          .order('id')
          .range(start, end);
      });
      return rows.map(toLeave);
    },

    async listPendingLeaves(companyId, department) {
      const rows = many(
        await db
          .from('leave_requests')
          .select()
          .eq('company_id', companyId)
          .eq('department', department)
          .eq('status', 'pending')
          .order('start_date'),
      );
      return rows.map(toLeave);
    },

    async insertLeave(companyId, leave) {
      const row = one(
        await db
          .from('leave_requests')
          .insert({
            company_id: companyId,
            employee_id: leave.employeeId,
            employee_name: leave.employeeName,
            department: leave.department,
            type: leave.type,
            start_date: leave.startDate,
            end_date: leave.endDate,
            start_time: leave.startTime,
            end_time: leave.endTime,
            days: leave.days,
            reason: leave.reason,
            status: leave.status,
            requested_at: leave.requestedAt,
            decided_at: leave.decidedAt,
            decided_by: leave.decidedBy,
          })
          .select()
          .single(),
      );
      return toLeave(row);
    },

    async transitionLeave(id, from, patch) {
      const values: Row = { status: patch.status };
      if (patch.decidedAt !== undefined) values.decided_at = patch.decidedAt;
      if (patch.decidedBy !== undefined) values.decided_by = patch.decidedBy;

      const row = check(
        await db
          .from('leave_requests')
          .update(values)
          .eq('id', id)
          .in('status', [...from])
          .select()
          .maybeSingle(),
      );
      return row ? toLeave(row) : null;
    },

    async listHolidays(from, to) {
      const rows = many(
        await db.from('holidays').select('date').gte('date', from).lte('date', to),
      );
      return rows.map((row) => row.date as string);
    },
  };
}
