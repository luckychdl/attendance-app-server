import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';

import { unauthorized } from '../common/errors.ts';
import { CLOCK, ENV, REPO } from '../common/tokens.ts';
import type { Env } from '../env.ts';
import type { Clock } from '../lib/time.ts';
import type { EmployeeRow, Repo } from '../repo/types.ts';
import type { Employee, Session } from '../types.ts';

/** 없는 사번일 때도 해시 비교를 한 번 돌려, 응답 시간으로 사번 유무가 드러나지 않게 한다. */
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
  };
}

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

  /** 사번 + 비밀번호 로그인 */
  async login(employeeNo: string, password: string): Promise<Session> {
    const employee = await this.repo.findEmployeeByNo(employeeNo);
    const matched = await bcrypt.compare(password, employee?.passwordHash ?? DUMMY_HASH);
    if (!employee || !employee.active || !matched) {
      throw unauthorized('사번 또는 비밀번호가 올바르지 않습니다.');
    }

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
