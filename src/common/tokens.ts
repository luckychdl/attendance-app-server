/** 클래스가 아닌 의존성(환경 변수, 시계, 저장소)을 주입할 때 쓰는 토큰 */
export const ENV = Symbol('ENV');
export const CLOCK = Symbol('CLOCK');
export const REPO = Symbol('REPO');
