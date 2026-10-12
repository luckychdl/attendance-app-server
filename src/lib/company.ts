/** 같은 회사를 가리는 기준. 앞뒤·연속 공백과 대소문자 차이는 같은 이름으로 본다. */
export function companyKey(name: string) {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}
