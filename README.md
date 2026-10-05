# 출근체크 서버 (attendance-app-server)

[attendance-app](../attendance-app)의 API 서버. [NestJS](https://nestjs.com) 12, DB는 Supabase(Postgres).
앱의 목(mock) 구현과 같은 규칙으로 동작하도록 `src/lib`의 판정 로직을 그대로 옮겼습니다.

## 시작하기

Node 22.18 이상이 필요합니다.

```bash
npm install
cp .env.example .env     # SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, JWT_SECRET 채우기
```

1. Supabase 프로젝트의 **SQL Editor**에 [supabase/migrations/0001_init.sql](supabase/migrations/0001_init.sql)을 붙여 넣어 실행합니다.
2. 초기 데이터를 넣습니다.

   ```bash
   npm run seed -- --demo   # 직원 계정 + 공휴일 + 근태·휴가 예시 (--demo 를 빼면 계정과 공휴일만)
   ```

3. 서버를 띄웁니다.

   ```bash
   npm run dev                    # nest start --watch, 파일이 바뀌면 다시 시작
   npm run build && npm start     # dist/ 로 빌드해서 실행
   ```

4. 앱의 `.env`에 주소를 넣으면 목 모드가 꺼지고 이 서버로 요청합니다.

   ```bash
   # attendance-app/.env — 실기기에서는 localhost 대신 PC의 LAN IP
   EXPO_PUBLIC_API_BASE_URL=http://192.168.0.10:3000
   ```

데모 계정 (비밀번호는 모두 `1234`, 운영 전에 꼭 바꾸세요):

| 사번 | 이름 | 부서 | 역할 |
| --- | --- | --- | --- |
| 1001 | 김민준 | 개발팀 | 팀장 |
| 1002 | 이서연 | 개발팀 | 팀원 |
| 2000 | 최수아 | 영업팀 | 팀장 |
| 2001 | 박지호 | 영업팀 | 팀원 |

## API

로그인을 뺀 모든 요청은 `Authorization: Bearer <token>`이 필요합니다.
요청/응답 모양은 [src/types.ts](src/types.ts)(앱의 `src/api/types.ts`와 동일)를 따릅니다.

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| POST | `/auth/login` | 사번 + 비밀번호 → `{ employee, token }` |
| GET | `/auth/me` | 토큰의 직원 정보 |
| GET | `/attendance/today?employeeId=` | 오늘 기록. 출근 전이면 `null` |
| GET | `/attendance/records?employeeId=&from=&to=` | 기간 내 기록, 최신순 |
| GET | `/attendance/summary?employeeId=&month=` | 월간 집계 |
| POST | `/attendance/check-in` · `/check-out` | 출근 · 퇴근 |
| GET · PATCH | `/worksite` | 근무지 조회 · 변경(팀장만) |
| GET | `/leave/balance?employeeId=&year=` | 연차 현황 |
| GET | `/leave/requests?employeeId=&from=&to=` | 기간과 겹치는 본인 신청 |
| GET | `/leave/inbox?approverId=` | 결재 대기함 (팀장) |
| POST | `/leave/requests` | 휴가 신청 |
| POST | `/leave/requests/:id/cancel` · `/approve` · `/reject` | 취소 · 승인 · 반려 |
| GET | `/health` | 상태 확인 |

실패하면 상태 코드와 함께 **사용자에게 보여 줄 문장을 `text/plain` 본문으로** 내려줍니다.
앱이 응답 본문을 그대로 알림창에 띄우기 때문입니다 (400 잘못된 요청 · 401 로그인 필요 · 403 권한 없음 · 404 없음 · 409 상태 충돌).

## 앱의 목 구현과 다른 점

서버라서 달라지거나 더 엄격해진 부분입니다.

- **본인 확인** — 앱은 요청마다 `employeeId`를 보내지만 누구인지는 토큰으로만 정합니다. 다른 사람의 id를 넣으면 403.
- **근무지 변경은 팀장만** — 근무지는 전 직원이 함께 쓰는 설정이라 `PATCH /worksite`는 `role: 'manager'`만 허용합니다.
  팀원이 앱의 내정보 화면에서 반경을 바꾸거나 "현재 위치를 근무지로 지정"을 누르면 403이 돌아옵니다.
- **반경 검사** — 좌표가 근무지 반경 밖이거나 위치가 없는데 사유(`note`)도 없으면 출퇴근 요청을 거절합니다.
- **타임존** — 근무일과 지각 판정은 기기 시각이 아니라 `APP_TIMEZONE`(기본 `Asia/Seoul`) 기준입니다.
- **상태 계산** — 퇴근 전 기록의 상태는 읽는 시점에 정합니다 (오늘이면 `working`, 지난 날이면 `missingCheckOut`).
- **연차 부여** — 15일 고정 대신 입사일(`employees.hired_at`)로 계산합니다. 입사한 해는 한 달에 1일(최대 11일),
  이듬해부터 15일에 2년마다 1일씩 늘어 최대 25일. `employees.annual_leave_days`를 채우면 그 값을 씁니다.
- **공휴일** — `holidays` 테이블의 날짜는 주말처럼 차감 일수에서 빠지고, 그날의 반차·시차는 거절됩니다.
  앱의 신청 화면은 공휴일을 모르므로 미리 보여 주는 일수와 실제 차감 일수가 다를 수 있습니다.
- **결재** — 같은 부서 팀장이 결재하고, 팀장 본인 신청은 바로 승인됩니다 (목 구현과 동일).
  팀장이 없는 부서의 신청은 결재할 사람이 없으니 부서마다 팀장을 한 명 두세요.

## 구조

기능별 Nest 모듈로 나눴습니다. 컨트롤러는 입력 검증과 본인 확인만 하고, 규칙은 서비스와 `lib`에 있습니다.

```
src/
  main.ts                 # 서버 시작
  app.module.ts           # 모듈 조립, 전역 예외 필터 등록
  auth/                   # 로그인, JWT 발급·검증, 전역 AuthGuard, @Public() · @CurrentEmployee()
  attendance/             # 출퇴근 (controller · service · module)
  worksite/               # 근무지
  leave/                  # 휴가 신청 · 결재
  common/
    core.module.ts        #   전역 모듈: 환경 변수(ENV) · 시계(CLOCK) · 저장소(REPO) 제공
    text-exception.filter.ts  # 모든 실패 응답 → text/plain 문장
    zod.pipe.ts           #   본문·쿼리 검증 파이프
    errors.ts             #   사용자에게 보여 줄 문장을 담은 예외
  lib/                    # 순수 규칙 (근태 판정, 휴가 계산, 날짜, 거리) — 앱의 src/lib 과 짝
  repo/
    types.ts              #   저장소 인터페이스
    supabase.ts           #   Supabase 구현 (service_role 키 사용)
scripts/seed.ts           # 초기·데모 데이터
supabase/migrations       # 테이블 정의
test/                     # AppModule 을 그대로 띄우고 저장소만 메모리로 바꾼 API 테스트
```

- 인증은 전역 가드라서 새 컨트롤러는 기본으로 로그인이 필요합니다. 열어 둘 경로에만 `@Public()`을 붙입니다.
- 실패는 `common/errors.ts`의 `badRequest()` · `conflict()` 등으로 던지면 문장이 그대로 응답 본문이 됩니다.
- POST는 Nest 기본값(201) 대신 `@HttpCode(200)`으로 맞췄습니다.

DB 테이블은 모두 RLS를 켜고 정책을 두지 않았습니다. 서버의 service_role 키로만 접근하고,
앱에는 Supabase 키를 넣지 않습니다.

## 직원 추가

비밀번호는 bcrypt 해시로 저장합니다. 해시를 만든 뒤 Supabase에서 `employees`에 한 줄을 넣습니다.

```bash
node -e "console.log(require('bcryptjs').hashSync(process.argv[1], 10))" '새비밀번호'
```

## 확인

```bash
npm run typecheck
npm test
```
