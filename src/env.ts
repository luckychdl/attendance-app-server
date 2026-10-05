export type Env = {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  jwtSecret: string;
  tokenTtlDays: number;
  port: number;
  timeZone: string;
};

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`환경 변수 ${name} 가 비어 있습니다. .env 를 확인해 주세요.`);
  return value;
}

export function loadEnv(): Env {
  try {
    process.loadEnvFile();
  } catch {
    // .env 가 없으면 이미 주입된 환경 변수만 쓴다.
  }

  const jwtSecret = required('JWT_SECRET');
  if (jwtSecret.length < 32) throw new Error('JWT_SECRET 은 32자 이상이어야 합니다.');

  return {
    supabaseUrl: required('SUPABASE_URL'),
    supabaseServiceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
    jwtSecret,
    tokenTtlDays: Number(process.env.TOKEN_TTL_DAYS) || 30,
    port: Number(process.env.PORT) || 3000,
    timeZone: process.env.APP_TIMEZONE?.trim() || 'Asia/Seoul',
  };
}
