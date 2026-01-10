/**
 * Logger utility for consistent logging across the application.
 * In production, console.log and console.debug are silent.
 * In development, all logs are visible.
 * 
 * Usage:
 *   import { logger } from '@/lib/logger';
 *   logger.info('Something happened');
 *   logger.error('Something went wrong', error);
 */

const isDev = import.meta.env.DEV;

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface Logger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

const noop = () => {};

export const logger: Logger = {
  // Debug: only in development
  debug: isDev ? console.debug.bind(console) : noop,
  
  // Info: only in development
  info: isDev ? console.log.bind(console) : noop,
  
  // Warn: always visible (useful for deprecation notices, etc.)
  warn: console.warn.bind(console),
  
  // Error: always visible (critical issues should always be logged)
  error: console.error.bind(console),
};

export default logger;
