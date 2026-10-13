import 'reflect-metadata';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.ts';
import { CLOCK, ENV, REPO } from '../src/common/tokens.ts';
import type { Env } from '../src/env.ts';
import { grantedDays } from '../src/lib/leave-rules.ts';
import { createClock } from '../src/lib/time.ts';
import type { EmployeeRow } from '../src/repo/types.ts';
import { createMemoryRepo, DEFAULT_WORKSITE, type MemoryData } from './memory-repo.ts';

const PASSWORD_HASH = bcrypt.hashSync('1234', 4);
const HQ = { latitude: 37.5666805, longitude: 126.9784147 };
const FAR = { latitude: 37.4979, longitude: 127.0276 }; // 강남역

const TEST_ENV: Env = {
  supabaseUrl: 'http://unused',
  supabaseServiceRoleKey: 'unused',
  jwtSecret: 'test-secret-test-secret-test-secret!',
  tokenTtlDays: 30,
  port: 0,
  timeZone: 'Asia/Seoul',
};

function employee(id: string, patch: Partial<EmployeeRow>): EmployeeRow {
  return {
    id,
    companyId: 'c1',
    companyName: '테스트회사',
    employeeNo: id,
    name: id,
    department: '개발팀',
    position: '사원',
    role: 'member',
    passwordHash: PASSWORD_HASH,
    hiredAt: '2020-03-02',
    annualLeaveDays: 15,
    active: true,
    ...patch,
  };
}

/** 한국 시각으로 시계를 맞춘다. 2026-10-06 은 화요일 */
const kst = (date: string, time: string) => new Date(`${date}T${time}:00+09:00`);

let now: Date;
let data: MemoryData;
let app: INestApplication;
const tokens = new Map<string, string>();

beforeEach(async () => {
  now = kst('2026-10-06', '08:58');
  tokens.clear();
  data = {
    companies: [{ id: 'c1', name: '테스트회사', nameKey: '테스트회사' }],
    employees: [
      employee('1001', { name: '김민준', position: '팀장', role: 'manager' }),
      employee('1002', { name: '이서연' }),
      employee('2001', { name: '박지호', department: '영업팀' }),
      employee('2002', { name: '최영업', department: '영업팀', role: 'manager' }),
    ],
    worksites: { c1: { ...DEFAULT_WORKSITE, id: 'hq', ...HQ } },
    attendance: [],
    leaves: [],
    holidays: ['2026-10-09'],
  };

  // 실제 모듈 구성을 그대로 띄우고 환경 변수 · 시계 · 저장소만 바꿔 끼운다.
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ENV)
    .useValue(TEST_ENV)
    .overrideProvider(CLOCK)
    .useValue(createClock('Asia/Seoul', () => now))
    .overrideProvider(REPO)
    .useValue(createMemoryRepo(data))
    .compile();
  app = moduleRef.createNestApplication();
  await app.init();
});

afterEach(() => app.close());

async function call(as: string | null, method: string, path: string, body?: unknown) {
  if (as && !tokens.has(as)) {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ companyName: '테스트회사', employeeNo: as, password: '1234' });
    tokens.set(as, login.body.token);
  }

  let req = request(app.getHttpServer())[method.toLowerCase() as 'get' | 'post' | 'patch'](path);
  if (as) req = req.set('Authorization', `Bearer ${tokens.get(as)}`);
  const response = await (body === undefined ? req : req.send(body as object));

  // 성공은 JSON, 실패는 문장 그대로 온다.
  const isJson = response.type === 'application/json';
  return {
    status: response.status,
    type: response.type,
    text: response.text,
    body: isJson ? JSON.parse(response.text) : response.text,
  };
}

const check = (as: string, kind: 'in' | 'out', location: object | null = HQ, note?: string) =>
  call(as, 'POST', `/attendance/check-${kind}`, { employeeId: as, location, note });

const requestLeave = (as: string, input: object) =>
  call(as, 'POST', '/leave/requests', { employeeId: as, ...input });

describe('인증', () => {
  it('사번과 비밀번호로 세션을 받는다', async () => {
    const { status, body } = await call(null, 'POST', '/auth/login', {
      companyName: ' 테스트회사 ',
      employeeNo: ' 1001 ',
      password: '1234',
    });
    expect(status).toBe(200);
    expect(body.employee).toEqual({
      id: '1001',
      employeeNo: '1001',
      name: '김민준',
      department: '개발팀',
      position: '팀장',
      role: 'manager',
      companyName: '테스트회사',
    });
    expect(body.token).toEqual(expect.any(String));

    expect((await call('1001', 'GET', '/auth/me')).body).toEqual(body.employee);
  });

  it('틀리면 문장을 text/plain 본문으로 내려준다', async () => {
    for (const input of [
      { companyName: '테스트회사', employeeNo: '1001', password: 'nope' },
      { companyName: '테스트회사', employeeNo: '9999', password: '1234' },
      { companyName: '없는회사', employeeNo: '1001', password: '1234' },
    ]) {
      const { status, type, body } = await call(null, 'POST', '/auth/login', input);
      expect(status).toBe(401);
      expect(type).toBe('text/plain');
      expect(body).toBe('회사명, 사번 또는 비밀번호가 올바르지 않습니다.');
    }
  });

  it('토큰이 없거나, 만료됐거나, 퇴사 처리되면 막는다', async () => {
    expect((await call(null, 'GET', '/worksite')).body).toBe('로그인이 필요합니다.');

    expect((await call('1002', 'GET', '/worksite')).status).toBe(200);
    data.employees[1].active = false;
    expect((await call('1002', 'GET', '/worksite')).status).toBe(401);
    data.employees[1].active = true;

    now = kst('2026-11-06', '09:00');
    expect((await call('1002', 'GET', '/worksite')).status).toBe(401);
  });

  it('다른 직원의 id 로는 조회할 수 없다', async () => {
    const { status } = await call('1002', 'GET', '/attendance/today?employeeId=1001');
    expect(status).toBe(403);
  });

  it('없는 경로와 깨진 요청도 한국어 문장으로 답한다', async () => {
    expect(await call(null, 'GET', '/health')).toMatchObject({ status: 200, body: { ok: true } });
    expect(await call(null, 'GET', '/nope')).toMatchObject({
      status: 404,
      body: '요청한 경로를 찾을 수 없습니다.',
    });

    const broken = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Content-Type', 'application/json')
      .send('{oops');
    expect(broken.status).toBe(400);
    expect(broken.text).toBe('요청 형식이 올바르지 않습니다.');

    expect(
      (await call(null, 'POST', '/auth/login', { companyName: '테스트회사', employeeNo: '1001' }))
        .status,
    ).toBe(400);
  });
});

describe('회원가입', () => {
  const profile = { name: '한새롬', department: '디자인팀', position: '대표', password: 'pass1234' };
  const signup = (input: object) => call(null, 'POST', '/auth/signup', { ...profile, ...input });
  const as = (token: string, method: 'get' | 'post' | 'patch', path: string, body?: object) => {
    const req = request(app.getHttpServer())[method](path).set('Authorization', `Bearer ${token}`);
    return body ? req.send(body) : req;
  };

  it('처음 보는 회사명이면 회사와 기본 근무지를 만들고 관리자가 된다', async () => {
    const { status, body } = await signup({ companyName: ' 새 회사 ', employeeNo: '1' });
    expect(status).toBe(200);
    expect(body.employee).toMatchObject({
      employeeNo: '1',
      name: '한새롬',
      role: 'manager',
      companyName: '새 회사',
    });

    const worksite = await as(body.token, 'get', '/worksite');
    expect(worksite.body).toMatchObject({ name: '본사', radiusMeters: 200 });
    expect(worksite.body.id).not.toBe('hq');

    // 가입한 회사명 · 사번 · 비밀번호로 로그인한다. 회사명의 공백·대소문자 차이는 같은 회사로 본다.
    const login = await call(null, 'POST', '/auth/login', {
      companyName: '새  회사',
      employeeNo: '1',
      password: 'pass1234',
    });
    expect(login.body.employee).toEqual(body.employee);
  });

  it('이미 있는 회사면 팀원으로 들어가고, 같은 사번은 받지 않는다', async () => {
    const joined = await signup({ companyName: '테스트회사', employeeNo: '3001' });
    expect(joined.body.employee).toMatchObject({ role: 'member', companyName: '테스트회사' });

    const duplicate = await signup({ companyName: '테스트회사', employeeNo: '1001' });
    expect(duplicate).toMatchObject({ status: 409, body: '이 회사에 이미 가입된 사번입니다.' });

    // 사번은 회사 안에서만 겹치지 않으면 된다.
    expect((await signup({ companyName: '다른회사', employeeNo: '1001' })).status).toBe(200);
  });

  it('빠진 항목이나 짧은 비밀번호는 거절한다', async () => {
    expect((await signup({ companyName: '', employeeNo: '1' })).status).toBe(400);
    expect((await signup({ companyName: '새 회사', employeeNo: '1', password: '123' })).status).toBe(400);
    expect((await signup({ companyName: '새 회사', employeeNo: '1', name: ' ' })).status).toBe(400);
  });

  it('회사끼리는 근무지와 휴가 결재가 섞이지 않는다', async () => {
    // 다른 회사의 개발팀 팀장
    const other = await signup({ companyName: '다른회사', employeeNo: '1', department: '개발팀' });
    const token = other.body.token;

    const moved = await as(token, 'patch', '/worksite', { radiusMeters: 1000 });
    expect(moved.body.radiusMeters).toBe(1000);
    expect((await call('1001', 'GET', '/worksite')).body).toMatchObject({ id: 'hq', radiusMeters: 200 });

    const pending = await requestLeave('1002', {
      type: 'annual',
      startDate: '2026-10-12',
      endDate: '2026-10-12',
    });
    expect(pending.body.status).toBe('pending');

    const inbox = await as(token, 'get', `/leave/inbox?approverId=${other.body.employee.id}`);
    expect(inbox.body).toEqual([]);
    const approve = await as(token, 'post', `/leave/requests/${pending.body.id}/approve`);
    expect(approve.status).toBe(404);
    expect(data.leaves[0].status).toBe('pending');
  });
});

describe('출퇴근', () => {
  it('출근 전의 오늘 기록은 JSON null 이다', async () => {
    const today = await call('1002', 'GET', '/attendance/today?employeeId=1002');
    expect(today).toMatchObject({ status: 200, type: 'application/json', text: 'null' });
  });

  it('출근 → 퇴근하면 근무시간과 상태가 정해진다', async () => {
    const checkedIn = await check('1002', 'in');
    expect(checkedIn.status).toBe(200);
    expect(checkedIn.body).toMatchObject({
      workDate: '2026-10-06',
      status: 'working',
      checkOutAt: null,
      checkInLocation: HQ,
    });
    expect((await call('1002', 'GET', '/attendance/today?employeeId=1002')).body.id).toBe(
      checkedIn.body.id,
    );
    expect((await check('1002', 'in')).status).toBe(409);

    now = kst('2026-10-06', '18:02');
    const checkedOut = await check('1002', 'out');
    expect(checkedOut.body).toMatchObject({ status: 'normal', workedMinutes: 544 });
    expect((await check('1002', 'out')).body).toBe('오늘은 이미 퇴근 체크를 완료했습니다.');
  });

  it('5분 여유를 넘기면 지각·조기퇴근이다', async () => {
    now = new Date('2026-10-06T09:05:20+09:00');
    await check('1001', 'in');
    now = kst('2026-10-06', '09:06');
    await check('1002', 'in');

    now = kst('2026-10-06', '17:55');
    expect((await check('1001', 'out')).body.status).toBe('normal');
    now = kst('2026-10-06', '17:54');
    expect((await check('1002', 'out')).body.status).toBe('lateAndEarlyLeave');

    const summary = await call('1002', 'GET', '/attendance/summary?employeeId=1002&month=2026-10');
    expect(summary.body).toEqual({
      month: '2026-10',
      workedDays: 1,
      lateDays: 1,
      earlyLeaveDays: 1,
      totalWorkedMinutes: 528,
    });
  });

  it('반경 밖이나 위치 없이 기록하려면 사유가 있어야 한다', async () => {
    expect((await check('1002', 'in', FAR)).status).toBe(400);
    expect((await check('1002', 'in', null)).status).toBe(400);

    const outside = await check('1002', 'in', FAR, '외부 근무');
    expect(outside.body).toMatchObject({ note: '외부 근무', checkInLocation: FAR });

    // 사무실로 돌아와 퇴근해도 출근 때 남긴 사유는 남는다.
    now = kst('2026-10-06', '18:00');
    expect((await check('1002', 'out')).body.note).toBe('외부 근무');
  });

  it('근무일은 한국 날짜로 끊고, 지난 날의 미퇴근은 퇴근 미체크가 된다', async () => {
    now = kst('2026-10-06', '00:30'); // UTC 로는 아직 5일
    expect((await check('1002', 'in')).body.workDate).toBe('2026-10-06');

    now = kst('2026-10-07', '08:50');
    expect((await call('1002', 'GET', '/attendance/today?employeeId=1002')).body).toBeNull();
    expect((await check('1002', 'out')).status).toBe(409);

    const records = await call(
      '1002',
      'GET',
      '/attendance/records?employeeId=1002&from=2026-10-01&to=2026-10-31',
    );
    expect(records.body).toHaveLength(1);
    expect(records.body[0].status).toBe('missingCheckOut');
  });

  it('승인된 오전 반차가 있으면 14시 출근이 기준이다', async () => {
    await requestLeave('1002', { type: 'halfAm', startDate: '2026-10-07', endDate: '2026-10-07' });
    const approved = await call('1001', 'POST', `/leave/requests/${data.leaves[0].id}/approve`);
    expect(approved.body.status).toBe('approved');

    now = kst('2026-10-07', '13:58');
    await check('1002', 'in');
    now = kst('2026-10-07', '18:00');
    expect((await check('1002', 'out')).body.status).toBe('normal');
  });
});

describe('근무지', () => {
  it('팀장만 바꿀 수 있다', async () => {
    expect((await call('1002', 'PATCH', '/worksite', { radiusMeters: 500 })).status).toBe(403);

    const updated = await call('1001', 'PATCH', '/worksite', {
      ...data.worksites.c1,
      id: 'ignored',
      radiusMeters: 500,
    });
    expect(updated.body).toMatchObject({ id: 'hq', radiusMeters: 500 });

    const invalid = await call('1001', 'PATCH', '/worksite', { endHour: 8 });
    expect(invalid.status).toBe(400);
  });
});

describe('휴가', () => {
  it('신청 → 결재함 → 승인까지 잔여가 따라 움직인다', async () => {
    // 목~월. 금요일(한글날)과 주말은 빠져 2일만 차감된다.
    const requested = await requestLeave('1002', {
      type: 'annual',
      startDate: '2026-10-08',
      endDate: '2026-10-12',
      reason: ' 가족 여행 ',
    });
    expect(requested.body).toMatchObject({
      employeeName: '이서연',
      department: '개발팀',
      days: 2,
      status: 'pending',
      reason: '가족 여행',
      decidedAt: null,
    });
    const id = requested.body.id;

    const balance = () => call('1002', 'GET', '/leave/balance?employeeId=1002&year=2026');
    expect((await balance()).body).toEqual({
      year: 2026,
      granted: 15,
      used: 0,
      pending: 2,
      remaining: 13,
    });

    expect((await call('1001', 'GET', '/leave/inbox?approverId=1001')).body).toHaveLength(1);
    expect((await call('2002', 'GET', '/leave/inbox?approverId=2002')).body).toHaveLength(0);
    expect((await call('1002', 'GET', '/leave/inbox?approverId=1002')).body).toEqual([]);

    expect((await call('2002', 'POST', `/leave/requests/${id}/approve`)).status).toBe(403);
    expect((await call('1002', 'POST', `/leave/requests/${id}/approve`)).status).toBe(403);

    const approved = await call('1001', 'POST', `/leave/requests/${id}/approve`);
    expect(approved.body).toMatchObject({ status: 'approved', decidedBy: '김민준' });
    expect((await call('1001', 'POST', `/leave/requests/${id}/reject`)).status).toBe(409);
    expect((await balance()).body).toMatchObject({ used: 2, pending: 0, remaining: 13 });

    const listed = await call(
      '1002',
      'GET',
      '/leave/requests?employeeId=1002&from=2026-10-12&to=2026-10-12',
    );
    expect(listed.body.map((item: any) => item.id)).toEqual([id]);
  });

  it('시차는 점심을 건너 끝나고, 시간이 겹치는 신청은 거절한다', async () => {
    const day = { startDate: '2026-10-07', endDate: '2026-10-07' };

    const hourly = await requestLeave('1002', {
      type: 'hourly',
      ...day,
      startTime: '11:00',
      hours: 2,
    });
    expect(hourly.body).toMatchObject({ startTime: '11:00', endTime: '14:00', days: 0.25 });

    expect((await requestLeave('1002', { type: 'halfPm', ...day })).status).toBe(200);
    expect((await requestLeave('1002', { type: 'halfAm', ...day })).body).toBe(
      '이미 신청한 휴가와 시간이 겹칩니다.',
    );
    expect((await requestLeave('1002', { type: 'annual', ...day })).status).toBe(409);

    for (const bad of [
      { startTime: '12:00', hours: 2 },
      { startTime: '17:00', hours: 2 },
      { startTime: '09:00', hours: 3 },
      { hours: 2 },
    ]) {
      const { status } = await requestLeave('1002', {
        type: 'hourly',
        startDate: '2026-10-13',
        endDate: '2026-10-13',
        ...bad,
      });
      expect(status).toBe(400);
    }
  });

  it('지난 날짜·시각, 쉬는 날, 잔여 초과는 거절한다', async () => {
    const single = (type: string, date: string, extra = {}) =>
      requestLeave('1002', { type, startDate: date, endDate: date, ...extra });

    expect((await single('annual', '2026-10-05')).status).toBe(400);
    expect((await single('halfAm', '2026-10-10')).status).toBe(400); // 토요일
    expect((await single('halfAm', '2026-10-09')).status).toBe(400); // 한글날
    expect((await single('annual', '2026-10-10')).body).toBe('고른 기간에 평일이 없습니다.');
    expect((await single('annual', '2026-02-30')).status).toBe(400);

    now = kst('2026-10-06', '10:30');
    expect((await single('hourly', '2026-10-06', { startTime: '10:00', hours: 2 })).status).toBe(400);
    expect((await single('hourly', '2026-10-06', { startTime: '11:00', hours: 2 })).status).toBe(200);

    data.employees[1].annualLeaveDays = 1;
    const over = await requestLeave('1002', {
      type: 'annual',
      startDate: '2026-10-13',
      endDate: '2026-10-14',
    });
    expect(over.body).toBe('남은 연차가 0.75일이라 신청할 수 없습니다.');
  });

  it('동시에 들어온 같은 신청은 하나만 받는다', async () => {
    await call('1002', 'GET', '/worksite'); // 토큰 준비
    const input = { type: 'annual', startDate: '2026-10-13', endDate: '2026-10-13' };
    const results = await Promise.all([requestLeave('1002', input), requestLeave('1002', input)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(data.leaves).toHaveLength(1);
  });

  it('팀장 신청은 바로 승인되고, 취소는 본인이 시작일 전까지만 한다', async () => {
    const mine = await requestLeave('1001', {
      type: 'annual',
      startDate: '2026-10-07',
      endDate: '2026-10-07',
    });
    expect(mine.body).toMatchObject({ status: 'approved', decidedBy: '김민준' });
    const id = mine.body.id;

    expect((await call('1002', 'POST', `/leave/requests/${id}/cancel`)).status).toBe(403);
    expect((await call('1001', 'POST', '/leave/requests/nope/cancel')).status).toBe(404);

    now = kst('2026-10-07', '08:00');
    expect((await call('1001', 'POST', `/leave/requests/${id}/cancel`)).status).toBe(409);

    now = kst('2026-10-06', '08:58');
    const cancelled = await call('1001', 'POST', `/leave/requests/${id}/cancel`);
    expect(cancelled.body.status).toBe('cancelled');
    expect((await call('1001', 'POST', `/leave/requests/${id}/cancel`)).status).toBe(409);

    // 취소한 자리는 다시 쓸 수 있다.
    const again = await requestLeave('1001', {
      type: 'annual',
      startDate: '2026-10-07',
      endDate: '2026-10-07',
    });
    expect(again.status).toBe(200);
  });
});

describe('관리자', () => {
  it('팀원은 쓸 수 없다', async () => {
    for (const path of ['/admin/overview', '/admin/employees', '/admin/leaves']) {
      expect(await call('1002', 'GET', path)).toMatchObject({
        status: 403,
        body: '관리자만 사용할 수 있습니다.',
      });
    }
    expect((await call(null, 'GET', '/admin/overview')).status).toBe(401);
  });

  it('오늘 현황과 기간별 근태를 회사 단위로 본다', async () => {
    data.companies.push({ id: 'c2', name: '다른회사', nameKey: '다른회사' });
    data.worksites.c2 = { ...DEFAULT_WORKSITE, id: 'other' };
    data.employees.push(employee('9001', { companyId: 'c2', companyName: '다른회사' }));

    await check('1002', 'in');
    await check('2001', 'in');
    await call(null, 'POST', '/auth/login', { companyName: '다른회사', employeeNo: '9001', password: '1234' })
      .then(({ body }) => tokens.set('9001', body.token));
    await check('9001', 'in');
    await requestLeave('2001', { type: 'annual', startDate: '2026-10-07', endDate: '2026-10-07' });

    const overview = (await call('1001', 'GET', '/admin/overview')).body;
    expect(overview.date).toBe('2026-10-06');
    expect(overview.records.map((r: { employeeId: string }) => r.employeeId).sort()).toEqual([
      '1002',
      '2001',
    ]);
    expect(overview.records[0].status).toBe('working');
    expect(overview.pendingLeaves).toBe(1);

    // 날짜가 지나면 퇴근 미체크로 읽힌다.
    now = kst('2026-10-07', '09:00');
    const range = '/admin/attendance?from=2026-10-01&to=2026-10-31';
    const records = (await call('1001', 'GET', range)).body;
    expect(records).toHaveLength(2);
    expect(records[0].status).toBe('missingCheckOut');
    expect((await call('1001', 'GET', `${range}&employeeId=1002`)).body).toHaveLength(1);
    expect((await call('1001', 'GET', `${range}&employeeId=9001`)).body).toHaveLength(0);

    expect((await call('1001', 'GET', '/admin/attendance?from=2026-10-02&to=2026-10-01')).status).toBe(400);
    expect((await call('1001', 'GET', '/admin/attendance?from=2025-01-01&to=2026-10-01')).status).toBe(400);
  });

  it('직원 목록에 연차 현황이 붙고, 회사 전체 휴가를 상태로 거른다', async () => {
    await requestLeave('1002', { type: 'annual', startDate: '2026-10-07', endDate: '2026-10-08' });
    await requestLeave('2001', { type: 'halfAm', startDate: '2026-10-12', endDate: '2026-10-12' });
    const inbox = (await call('2002', 'GET', '/leave/inbox?approverId=2002')).body;
    await call('2002', 'POST', `/leave/requests/${inbox[0].id}/approve`);

    const employees = (await call('1001', 'GET', '/admin/employees')).body;
    expect(employees.map((e: { employeeNo: string }) => e.employeeNo)).toEqual([
      '1001',
      '1002',
      '2001',
      '2002',
    ]);
    expect(employees[1]).toMatchObject({
      name: '이서연',
      hiredAt: '2020-03-02',
      active: true,
      leave: { year: 2026, granted: 15, used: 0, pending: 2, remaining: 13 },
    });
    expect(employees[1].passwordHash).toBeUndefined();
    expect(employees[2].leave).toMatchObject({ used: 0.5, pending: 0 });

    expect((await call('1001', 'GET', '/admin/leaves')).body).toHaveLength(2);
    const pending = (await call('1001', 'GET', '/admin/leaves?status=pending')).body;
    expect(pending.map((l: { employeeName: string }) => l.employeeName)).toEqual(['이서연']);
    expect(
      (await call('1001', 'GET', '/admin/leaves?from=2026-10-12&to=2026-10-12')).body,
    ).toHaveLength(1);
  });

  it('직원을 추가하고 인사 정보를 바꾼다', async () => {
    const input = { employeeNo: '1003', name: '정하늘', department: '개발팀', position: '사원', password: 'pass1234' };
    const created = await call('1001', 'POST', '/admin/employees', { ...input, hiredAt: '2026-01-01' });
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({
      employeeNo: '1003',
      role: 'member',
      hiredAt: '2026-01-01',
      companyName: '테스트회사',
      leave: { granted: 11 },
    });
    expect(await call('1001', 'POST', '/admin/employees', input)).toMatchObject({
      status: 409,
      body: '이미 쓰고 있는 사번입니다.',
    });
    expect((await call('1001', 'POST', '/admin/employees', { ...input, employeeNo: '1004', password: '1' })).status).toBe(400);

    const login = (password: string) =>
      call(null, 'POST', '/auth/login', { companyName: '테스트회사', employeeNo: '1003', password });
    expect((await login('pass1234')).status).toBe(200);

    const id = created.body.id;
    const updated = await call('1001', 'PATCH', `/admin/employees/${id}`, {
      department: '영업팀',
      role: 'manager',
      annualLeaveDays: 20,
      password: 'changed!',
    });
    expect(updated.body).toMatchObject({
      department: '영업팀',
      role: 'manager',
      annualLeaveDays: 20,
      leave: { granted: 20 },
    });
    expect((await login('pass1234')).status).toBe(401);
    expect((await login('changed!')).status).toBe(200);

    // 퇴사 처리하면 로그인이 막힌다.
    await call('1001', 'PATCH', `/admin/employees/${id}`, { active: false });
    expect((await login('changed!')).status).toBe(401);
  });

  it('본인의 권한은 내려놓지 못하고, 다른 회사 직원은 건드리지 못한다', async () => {
    expect(await call('1001', 'PATCH', '/admin/employees/1001', { role: 'member' })).toMatchObject({
      status: 400,
      body: '본인의 권한과 재직 상태는 직접 바꿀 수 없습니다.',
    });
    expect((await call('1001', 'PATCH', '/admin/employees/1001', { active: false })).status).toBe(400);
    expect((await call('1001', 'PATCH', '/admin/employees/1001', { position: '이사' })).body.position).toBe('이사');

    data.employees.push(employee('9001', { companyId: 'c2', companyName: '다른회사' }));
    expect((await call('1001', 'PATCH', '/admin/employees/9001', { name: '침입' })).status).toBe(404);
    expect((await call('1001', 'PATCH', '/admin/employees/none', { name: '침입' })).status).toBe(404);
    expect(data.employees.at(-1)!.name).toBe('9001');
  });
});

describe('규칙', () => {
  it('연차는 근속연수로 부여한다', () => {
    const hired = (hiredAt: string) => ({ hiredAt, annualLeaveDays: null });
    expect(grantedDays(hired('2026-03-15'), 2026)).toBe(9);
    expect(grantedDays(hired('2026-01-01'), 2026)).toBe(11);
    expect(grantedDays(hired('2025-07-01'), 2026)).toBe(15);
    expect(grantedDays(hired('2023-07-01'), 2026)).toBe(16);
    expect(grantedDays(hired('1990-01-01'), 2026)).toBe(25);
    expect(grantedDays(hired('2027-01-01'), 2026)).toBe(0);
    expect(grantedDays({ hiredAt: '2026-03-15', annualLeaveDays: 20 }, 2026)).toBe(20);
  });

  it('타임존 시각을 실제 시각으로 바꾼다', () => {
    const clock = createClock('Asia/Seoul');
    expect(clock.instantAt('2026-10-06', 9 * 60).toISOString()).toBe('2026-10-06T00:00:00.000Z');
    expect(clock.minutesSince('2026-10-06', '2026-10-06T15:30:00Z')).toBe(24 * 60 + 30);
  });
});
