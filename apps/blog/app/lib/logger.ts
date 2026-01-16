/**
 * 用于应用程序中一致日志记录的日志工具。
 * 在生产环境中，console.log 和 console.debug 是静默的。
 * 在开发环境中，所有日志都是可见的。
 * 
 * 用法:
 *   import { logger } from '@/lib/logger';
 *   logger.info('Something happened');
 *   logger.error('Something went wrong', error);
 */

const isDev = process.env.NODE_ENV === 'development';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface Logger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

const noop = () => {};

export const logger: Logger = {
  // 调试：仅在开发环境中
  debug: isDev ? console.debug.bind(console) : noop,
  
  // 信息：仅在开发环境中
  info: isDev ? console.log.bind(console) : noop,
  
  // 警告：始终可见 (用于弃用通知等)
  warn: console.warn.bind(console),
  
  // 错误：始终可见 (严重问题应始终记录)
  error: console.error.bind(console),
};

export default logger;
