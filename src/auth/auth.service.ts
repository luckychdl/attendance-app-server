import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';

import { conflict, unauthorized } from '../common/errors.ts';
import { CLOCK, ENV, REPO } from '../common/tokens.ts';
import type { Env } from '../env.ts';
import { companyKey } from '../lib/company.ts';
import type { Clock } from '../lib/time.ts';
import type { EmployeeRow, NewEmployee, Repo } from '../repo/types.ts';
import type { Employee, Session } from '../types.ts';

/** 없는 회사·사번일 때도 해시 비교를 한 번 돌려, 응답 시간으로 계정 유무가 드러나지 않게 한다. */
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

/** 비밀번호 해시 같은 서버 전용 필드를 떼고 앱이 아는 모양으로 */
export function toPublicEmployee(row: EmployeeRow): Employee {
  return {
    id: row.id,
    employeeNo: row.employeeNo,
    name: row.name,
    department: row.department,
    position: row.position,
    role: row.role,
    companyName: row.companyName,
  };
}

export type SignupInput = Omit<NewEmployee, 'passwordHash'> & {
  companyName: string;
  password: string;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(ENV) private readonly env: Env,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(REPO) private readonly repo: Repo,
  ) {}

  private nowSeconds() {
    return Math.floor(this.clock.now().getTime() / 1000);
  }

  /**
   * 회원가입. 처음 보는 회사 이름이면 회사를 만들고 가입자가 관리자(manager)가 된다.
   * 이미 있는 회사면 그 회사의 팀원(member)으로 들어간다.
   */
  async signup(input: SignupInput): Promise<Session> {
    const { companyName, password, ...profile } = input;
    const nameKey = companyKey(companyName);
    const employee: NewEmployee = { ...profile, passwordHash: await bcrypt.hash(password, 10) };

    let created: EmployeeRow | null = null;
    let company = await this.repo.findCompany(nameKey);
    if (!company) {
      created = await this.repo.createCompany(companyName.trim().replace(/\s+/g, ' '), nameKey, employee);
      // 그 사이 같은 이름으로 회사가 생겼으면 그 회사의 팀원으로 가입한다.
      if (!created) company = await this.repo.findCompany(nameKey);
    }
    if (!created && company) created = await this.repo.insertEmployee(company.id, employee);
    if (!created) throw conflict('이 회사에 이미 가입된 사번입니다.');

    return this.issue(created);
  }

  /** 회사명 + 사번 + 비밀번호 로그인. 사번은 회사 안에서만 유일하다. */
  async login(companyName: string, employeeNo: string, password: string): Promise<Session> {
    const company = await this.repo.findCompany(companyKey(companyName));
    const employee = company ? await this.repo.findEmployeeByNo(company.id, employeeNo) : null;
    const matched = await bcrypt.compare(password, employee?.passwordHash ?? DUMMY_HASH);
    if (!employee || !employee.active || !matched) {
      throw unauthorized('회사명, 사번 또는 비밀번호가 올바르지 않습니다.');
    }
    return this.issue(employee);
  }

  private async issue(employee: EmployeeRow): Promise<Session> {
    const issuedAt = this.nowSeconds();
    const token = await this.jwt.signAsync(
      { sub: employee.id, iat: issuedAt, exp: issuedAt + this.env.tokenTtlDays * 86_400 },
      { secret: this.env.jwtSecret, algorithm: 'HS256' },
    );
    return { employee: toPublicEmployee(employee), token };
  }

  /**
   * 토큰을 확인하고 직원 정보를 매 요청 새로 읽는다.
   * 부서·역할이 바뀌거나 퇴사 처리(active=false)되면 기존 토큰에도 바로 반영된다.
   */
  async authenticate(token: string): Promise<EmployeeRow> {
    const expired = '세션이 만료되었습니다. 다시 로그인해 주세요.';

    let employeeId: string | undefined;
    try {
      const payload = await this.jwt.verifyAsync<{ sub?: string }>(token, {
        secret: this.env.jwtSecret,
        algorithms: ['HS256'],
        clockTimestamp: this.nowSeconds(),
      });
      employeeId = payload.sub;
    } catch {
      throw unauthorized(expired);
    }

    const employee = employeeId ? await this.repo.findEmployeeById(employeeId) : null;
    if (!employee?.active) throw unauthorized(expired);
    return employee;
  }
}
