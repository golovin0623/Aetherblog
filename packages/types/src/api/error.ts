/**
 * API 错误类型
 */

export interface ApiError {
  code: number;
  message: string;
  details?: Record<string, string[]>;
  traceId?: string;
}

export class ApiException extends Error {
  code: number;
  details?: Record<string, string[]>;

  constructor(error: ApiError) {
    super(error.message);
    this.name = 'ApiException';
    this.code = error.code;
    this.details = error.details;
  }
}
