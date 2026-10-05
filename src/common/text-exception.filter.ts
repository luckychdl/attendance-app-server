import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

import { ApiException } from './errors.ts';

/** Nest 가 직접 던지는 오류(없는 경로, 깨진 JSON 등)는 영어 문장이라 상태 코드별 문장으로 바꾼다. */
const FALLBACK: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: '요청 형식이 올바르지 않습니다.',
  [HttpStatus.NOT_FOUND]: '요청한 경로를 찾을 수 없습니다.',
};

/** 모든 실패 응답을 문장 하나짜리 text/plain 본문으로 내려보낸다. */
@Catch()
export class TextExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(TextExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = '서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.';

    if (exception instanceof ApiException) {
      status = exception.getStatus();
      message = exception.message;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      message = FALLBACK[status] ?? '요청을 처리할 수 없습니다.';
    } else {
      this.logger.error(exception instanceof Error ? exception.stack : exception);
    }

    response.status(status).type('text/plain; charset=utf-8').send(message);
  }
}
