/* =============================================================
 * 日志行结构化解析
 * -------------------------------------------------------------
 * 后端 /system/logs 现在直接回传原始日志行（不再服务端预格式化），
 * 由前端统一解析。来源有三类，本模块全部兜底：
 *   1. zerolog JSON（backend）—— time 为 UnixMs 数字、含 caller。
 *   2. JSONFormatter JSON（ai-service）—— timestamp 为 ISO 字符串。
 *   3. 纯文本 / 夹带 ANSI 的控制台行（uvicorn、panic、历史污染行）。
 *
 * 解析结果同时服务「优化模式」（结构化卡片）与「原始模式」（终端风格还原）。
 * ============================================================= */

import { stripAnsi } from './ansi';

export type LogLevel = 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';

// 兼容全名与 zerolog 三字母缩写（INF/WRN/ERR/DBG/TRC/FTL）。
const LEVEL_NORMALIZE: Record<string, LogLevel> = {
  TRACE: 'TRACE', TRC: 'TRACE',
  DEBUG: 'DEBUG', DBG: 'DEBUG',
  INFO: 'INFO', INF: 'INFO',
  WARN: 'WARN', WRN: 'WARN', WARNING: 'WARN',
  ERROR: 'ERROR', ERR: 'ERROR',
  FATAL: 'FATAL', FTL: 'FATAL', PANIC: 'FATAL', PNC: 'FATAL',
};

export interface ParsedLogEntry {
  /** 去除 ANSI 后的原始行（关键字匹配 / 兜底展示用）。 */
  raw: string;
  /** 是否成功解析为结构化 JSON 日志。 */
  isJson: boolean;
  /** HH:mm:ss(.SSS)，解析失败为 null。 */
  time: string | null;
  level: LogLevel | null;
  service: string | null;
  caller: string | null;
  traceId: string | null;
  /** 主消息。 */
  message: string;
  // HTTP 请求日志（命中后单独高亮）
  method: string | null;
  path: string | null;
  status: number | null;
  latencyMs: number | null;
  /** 额外结构化字段（已排除被单列渲染的保留键）。 */
  fields: Array<[string, string]>;
}

// 这些键会被单独渲染，不进入「额外字段」chips。
const RESERVED_KEYS = new Set([
  'level', 'time', 'timestamp', 'caller', 'service', 'message',
  'traceid', 'trace_id', 'method', 'path', 'status', 'latency_ms', 'latencyms',
]);

// 纯文本兜底用的正则（锚定行首，避免误命中正文）。
const ISO_TS_RE = /^(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2}:\d{2}(?:\.\d+)?)(?:Z|[+-]\d{2}:?\d{2})?/;
const CONSOLE_TS_RE = /^(\d{2}:\d{2}:\d{2}(?:\.\d+)?)\b/;
const NGINX_TS_RE = /^\[(\d{2})\/(\w{3})\/(\d{4}):(\d{2}:\d{2}:\d{2})\s/;
const LEVEL_RE = /\b(TRACE|TRC|DEBUG|DBG|INFO|INF|WARN(?:ING)?|WRN|ERROR|ERR|FATAL|FTL|PANIC|PNC)\b/;
const HTTP_RE = /"(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+([^\s"]+)\s+HTTP\/[\d.]+"\s+(\d{3})/;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** 把 zerolog UnixMs 数字 / ISO 字符串归一成 HH:mm:ss。 */
function formatTime(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    // UnixMs（13 位）兜底兼容秒级（10 位）。
    const ms = value > 1e12 ? value : value * 1000;
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return null;
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  }
  if (typeof value === 'string' && value) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) {
      return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
    }
    // 已经是 HH:mm:ss 形态时直接取用
    const m = value.match(/(\d{2}:\d{2}:\d{2})/);
    if (m) return m[1];
  }
  return null;
}

function stringifyFieldValue(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function emptyEntry(raw: string): ParsedLogEntry {
  return {
    raw,
    isJson: false,
    time: null,
    level: null,
    service: null,
    caller: null,
    traceId: null,
    message: raw,
    method: null,
    path: null,
    status: null,
    latencyMs: null,
    fields: [],
  };
}

function parseJsonEntry(line: string): ParsedLogEntry | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;

  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (typeof obj !== 'object' || obj === null) return null;

  const entry = emptyEntry(line);
  entry.isJson = true;

  entry.time = formatTime(obj.time ?? obj.timestamp);

  const rawLevel = typeof obj.level === 'string' ? obj.level.toUpperCase() : '';
  entry.level = LEVEL_NORMALIZE[rawLevel] ?? null;

  entry.service = typeof obj.service === 'string' ? obj.service : null;
  entry.caller = typeof obj.caller === 'string' ? obj.caller : null;
  entry.traceId =
    typeof obj.traceId === 'string'
      ? obj.traceId
      : typeof obj.trace_id === 'string'
        ? (obj.trace_id as string)
        : null;
  entry.message = typeof obj.message === 'string' ? obj.message : '';

  if (typeof obj.method === 'string') entry.method = obj.method;
  if (typeof obj.path === 'string') entry.path = obj.path;
  if (typeof obj.status === 'number') entry.status = obj.status;
  if (typeof obj.latency_ms === 'number') entry.latencyMs = obj.latency_ms as number;

  for (const [key, value] of Object.entries(obj)) {
    if (RESERVED_KEYS.has(key.toLowerCase())) continue;
    if (value === undefined) continue;
    entry.fields.push([key, stringifyFieldValue(value)]);
  }

  return entry;
}

function parseTextEntry(line: string): ParsedLogEntry {
  const clean = stripAnsi(line);
  const entry = emptyEntry(clean);
  let rest = clean;

  // 时间戳：ISO → 控制台 HH:mm:ss → nginx
  const iso = clean.match(ISO_TS_RE);
  if (iso) {
    entry.time = iso[2];
    rest = rest.replace(iso[0], '').trim();
  } else {
    const con = clean.match(CONSOLE_TS_RE);
    if (con) {
      entry.time = con[1];
      rest = rest.replace(con[0], '').trim();
    } else {
      const ng = clean.match(NGINX_TS_RE);
      if (ng) {
        entry.time = ng[4];
        rest = rest.replace(ng[0], '').trim();
      }
    }
  }

  // 级别 token
  const lvl = rest.match(LEVEL_RE);
  if (lvl) {
    entry.level = LEVEL_NORMALIZE[lvl[1].toUpperCase()] ?? null;
    rest = rest.replace(new RegExp(`^\\s*${lvl[1]}\\s*[:|>]?\\s*`, 'i'), '');
  }

  // nginx HTTP 行
  const http = clean.match(HTTP_RE);
  if (http) {
    entry.method = http[1];
    entry.path = http[2];
    entry.status = parseInt(http[3], 10);
    rest = rest.replace(http[0], '').trim();
  }

  entry.message = rest.trim();
  return entry;
}

/** 把一行原始日志解析为结构化条目，永不抛错。 */
export function parseLogEntry(line: string): ParsedLogEntry {
  return parseJsonEntry(line) ?? parseTextEntry(line);
}
