import type { PipeTransform } from '@nestjs/common';
import { z } from 'zod';

import { badRequest, forbidden } from './errors.ts';
import { isDateKey, isMonthKey } from '../lib/time.ts';

/** 본문·쿼리를 zod 스키마로 검증한다. `@Body(new ZodPipe(schema))` */
export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: z.ZodType<T>) {}

  transform(value: unknown) {
    const result = this.schema.safeParse(value);
    if (!result.success) throw badRequest('요청 형식이 올바르지 않습니다.');
    return result.data;
  }
}

export const dateKey = z.string().refine(isDateKey);
export const monthKey = z.string().refine(isMonthKey);
export const uuid = z.string().regex(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i);

/**
 * 앱은 요청마다 employeeId 를 실어 보내지만, 누구인지는 토큰으로만 정한다.
 * 다른 직원의 id 를 넣은 요청은 거절한다.
 */
export function assertSelf(employeeId: string, me: { id: string }) {
  if (employeeId !== me.id) throw forbidden('본인 정보만 조회하거나 변경할 수 있습니다.');
}
