import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * 사용자에게 그대로 보여 줄 문장을 담은 오류.
 * 앱은 실패 응답의 본문을 알림창에 띄우므로 (client.ts 의 ApiError) 메시지는 사람이 읽을 문장으로 쓴다.
 */
export class ApiException extends HttpException {}

export const badRequest = (message: string) => new ApiException(message, HttpStatus.BAD_REQUEST);
export const unauthorized = (message = '로그인이 필요합니다.') =>
  new ApiException(message, HttpStatus.UNAUTHORIZED);
export const forbidden = (message: string) => new ApiException(message, HttpStatus.FORBIDDEN);
export const notFound = (message: string) => new ApiException(message, HttpStatus.NOT_FOUND);
export const conflict = (message: string) => new ApiException(message, HttpStatus.CONFLICT);
