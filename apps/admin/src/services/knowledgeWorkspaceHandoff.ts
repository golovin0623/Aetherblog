export const DEFAULT_KNOWLEDGE_HANDOFF_TTL_MS = 10 * 60 * 1000;
export const MAX_KNOWLEDGE_HANDOFF_TTL_MS = 30 * 60 * 1000;
export const MAX_KNOWLEDGE_HANDOFF_PROMPT_LENGTH = 4_000;
export const MAX_KNOWLEDGE_HANDOFF_LABEL_LENGTH = 160;
export const MAX_KNOWLEDGE_BASE_REFS = 10;
export const MAX_ATLAS_KP_REFS = 12;
export const MAX_ATLAS_CARRIER_REFS = 6;

const HANDOFF_STORAGE_PREFIX = 'aetherblog.admin.knowledge-workspace.handoff.v1:';
const KNOWLEDGE_WORKSPACE_INTENTS = ['ask', 'summarize', 'compare', 'verify'] as const;
const KNOWLEDGE_WORKSPACE_ORIGINS = [
  'knowledge-base',
  'note',
  'atlas',
  'knowledge-workspace',
] as const;
const KNOWLEDGE_CONTEXT_REF_KINDS = ['knowledge-base', 'atlas-kp', 'atlas-carrier'] as const;

export type KnowledgeContextRef =
  | { kind: 'knowledge-base'; id: number; label: string }
  | { kind: 'atlas-kp'; id: number; label: string }
  | { kind: 'atlas-carrier'; id: number; label: string };

export type KnowledgeContextSelection =
  | { mode: 'auto' }
  | { mode: 'none' }
  | { mode: 'selected'; refs: KnowledgeContextRef[] };

export type KnowledgeWorkspaceIntent = (typeof KNOWLEDGE_WORKSPACE_INTENTS)[number];
export type KnowledgeWorkspaceOrigin = (typeof KNOWLEDGE_WORKSPACE_ORIGINS)[number];

export interface KnowledgeWorkspaceHandoff {
  schemaVersion: 1;
  userId: string;
  origin: KnowledgeWorkspaceOrigin;
  intent: KnowledgeWorkspaceIntent;
  context: KnowledgeContextSelection;
  draftPrompt?: string;
  createdAt: number;
  expiresAt: number;
}

export interface KnowledgeWorkspaceHandoffInput {
  userId: string;
  origin: KnowledgeWorkspaceOrigin;
  intent: KnowledgeWorkspaceIntent;
  context: KnowledgeContextSelection;
  draftPrompt?: string;
}

export interface KnowledgeHandoffStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface KnowledgeWorkspaceHandoffOptions {
  storage?: KnowledgeHandoffStorage | null;
  now?: () => number;
}

export interface StoreKnowledgeWorkspaceHandoffOptions extends KnowledgeWorkspaceHandoffOptions {
  ttlMs?: number;
}

export type KnowledgeWorkspaceHandoffErrorCode =
  | 'invalid-user'
  | 'invalid-origin'
  | 'invalid-intent'
  | 'invalid-selection'
  | 'invalid-ref'
  | 'invalid-prompt'
  | 'invalid-ttl'
  | 'invalid-time'
  | 'invalid-schema'
  | 'invalid-payload'
  | 'malformed-payload'
  | 'user-mismatch'
  | 'storage-unavailable'
  | 'storage-read-failed'
  | 'storage-write-failed'
  | 'storage-remove-failed';

export interface KnowledgeWorkspaceHandoffError {
  code: KnowledgeWorkspaceHandoffErrorCode;
  message: string;
}

export type StoreKnowledgeWorkspaceHandoffResult =
  | {
      ok: true;
      status: 'stored';
      key: string;
      handoff: KnowledgeWorkspaceHandoff;
    }
  | {
      ok: false;
      status: 'invalid' | 'storage-error';
      error: KnowledgeWorkspaceHandoffError;
    };

export type ConsumeKnowledgeWorkspaceHandoffResult =
  | { ok: true; status: 'empty' }
  | { ok: true; status: 'consumed'; handoff: KnowledgeWorkspaceHandoff }
  | {
      ok: false;
      status: 'invalid' | 'expired' | 'storage-error';
      error: KnowledgeWorkspaceHandoffError;
    };

export interface KnowledgeContextChatAtlasScope {
  kpIds: number[];
  carrierIds: number[];
  neighborhoodDepth: 1;
  includeEvidence: true;
  semanticRecall: true;
  semanticLimit: 8;
}

export type KnowledgeContextChatPayload =
  | {
      atlasScope: KnowledgeContextChatAtlasScope;
    }
  | {
      kbIds: number[] | null;
      atlasScope: KnowledgeContextChatAtlasScope | null;
    };

export type KnowledgeContextAdapterErrorCode =
  | 'invalid-selection'
  | 'invalid-ref'
  | 'kb-limit-exceeded'
  | 'kp-limit-exceeded'
  | 'carrier-limit-exceeded';

export type KnowledgeContextAdapterResult =
  | { ok: true; value: KnowledgeContextChatPayload }
  | {
      ok: false;
      error: {
        code: KnowledgeContextAdapterErrorCode;
        message: string;
      };
    };

type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: KnowledgeWorkspaceHandoffError };

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isIntent(value: unknown): value is KnowledgeWorkspaceIntent {
  return (
    typeof value === 'string' &&
    (KNOWLEDGE_WORKSPACE_INTENTS as readonly string[]).includes(value)
  );
}

function isOrigin(value: unknown): value is KnowledgeWorkspaceOrigin {
  return (
    typeof value === 'string' &&
    (KNOWLEDGE_WORKSPACE_ORIGINS as readonly string[]).includes(value)
  );
}

function isRefKind(value: unknown): value is KnowledgeContextRef['kind'] {
  return (
    typeof value === 'string' &&
    (KNOWLEDGE_CONTEXT_REF_KINDS as readonly string[]).includes(value)
  );
}

function invalid(
  code: KnowledgeWorkspaceHandoffErrorCode,
  message: string,
): ValidationResult<never> {
  return { ok: false, error: { code, message } };
}

function normalizeUserId(value: unknown): ValidationResult<string> {
  if (typeof value !== 'string' || !value.trim()) {
    return invalid('invalid-user', '无法确认当前用户，知识交接未保存。');
  }
  return { ok: true, value: value.trim() };
}

function normalizeDraftPrompt(value: unknown): ValidationResult<string | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== 'string') {
    return invalid('invalid-prompt', '建议问题必须是文本。');
  }
  const normalized = value.trim();
  if (!normalized) return { ok: true, value: undefined };
  if (normalized.length > MAX_KNOWLEDGE_HANDOFF_PROMPT_LENGTH) {
    return invalid(
      'invalid-prompt',
      `建议问题不能超过 ${MAX_KNOWLEDGE_HANDOFF_PROMPT_LENGTH} 个字符。`,
    );
  }
  return { ok: true, value: normalized };
}

function normalizeRef(value: unknown): ValidationResult<KnowledgeContextRef> {
  if (!isRecord(value) || !isRefKind(value.kind) || !isPositiveSafeInteger(value.id)) {
    return invalid('invalid-ref', '知识来源包含无效的类型或 ID。');
  }
  if (typeof value.label !== 'string') {
    return invalid('invalid-ref', '知识来源缺少可识别的名称。');
  }
  const label = value.label.trim();
  if (!label || label.length > MAX_KNOWLEDGE_HANDOFF_LABEL_LENGTH) {
    return invalid(
      'invalid-ref',
      `知识来源名称必须为 1–${MAX_KNOWLEDGE_HANDOFF_LABEL_LENGTH} 个字符。`,
    );
  }
  return {
    ok: true,
    value: { kind: value.kind, id: value.id, label } as KnowledgeContextRef,
  };
}

function sourceLimitError(refs: readonly KnowledgeContextRef[]): KnowledgeWorkspaceHandoffError | null {
  let knowledgeBases = 0;
  let knowledgePoints = 0;
  let carriers = 0;
  for (const ref of refs) {
    if (ref.kind === 'knowledge-base') knowledgeBases += 1;
    if (ref.kind === 'atlas-kp') knowledgePoints += 1;
    if (ref.kind === 'atlas-carrier') carriers += 1;
  }
  if (knowledgeBases > MAX_KNOWLEDGE_BASE_REFS) {
    return { code: 'invalid-selection', message: `最多可同时使用 ${MAX_KNOWLEDGE_BASE_REFS} 个知识库。` };
  }
  if (knowledgePoints > MAX_ATLAS_KP_REFS) {
    return { code: 'invalid-selection', message: `最多可同时使用 ${MAX_ATLAS_KP_REFS} 个知识点。` };
  }
  if (carriers > MAX_ATLAS_CARRIER_REFS) {
    return { code: 'invalid-selection', message: `最多可同时使用 ${MAX_ATLAS_CARRIER_REFS} 个来源载体。` };
  }
  return null;
}

function normalizeContext(value: unknown): ValidationResult<KnowledgeContextSelection> {
  if (!isRecord(value) || typeof value.mode !== 'string') {
    return invalid('invalid-selection', '请选择自动、指定来源或不使用来源。');
  }
  if (value.mode === 'auto' || value.mode === 'none') {
    if (hasOwn(value, 'refs')) {
      return invalid('invalid-selection', '自动或不使用来源模式不能同时携带指定来源。');
    }
    return { ok: true, value: { mode: value.mode } };
  }
  if (value.mode !== 'selected' || !Array.isArray(value.refs) || value.refs.length === 0) {
    return invalid('invalid-selection', '指定来源模式至少需要一个知识来源。');
  }

  const refs: KnowledgeContextRef[] = [];
  const seen = new Set<string>();
  for (const candidate of value.refs) {
    const normalized = normalizeRef(candidate);
    if (!normalized.ok) return normalized;
    const dedupeKey = `${normalized.value.kind}:${normalized.value.id}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    refs.push(normalized.value);
  }
  if (refs.length === 0) {
    return invalid('invalid-selection', '指定来源模式至少需要一个知识来源。');
  }
  return { ok: true, value: { mode: 'selected', refs } };
}

function resolveNow(now: (() => number) | undefined): ValidationResult<number> {
  let value: number;
  try {
    value = (now ?? Date.now)();
  } catch {
    return invalid('invalid-time', '无法确定知识交接的有效时间。');
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    return invalid('invalid-time', '无法确定知识交接的有效时间。');
  }
  return { ok: true, value };
}

function resolveStorage(storage: KnowledgeHandoffStorage | null | undefined): KnowledgeHandoffStorage | null {
  if (storage !== undefined) return storage;
  try {
    if (typeof window === 'undefined') return null;
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function storageError(
  code:
    | 'storage-unavailable'
    | 'storage-read-failed'
    | 'storage-write-failed'
    | 'storage-remove-failed',
  message: string,
): {
  ok: false;
  status: 'storage-error';
  error: KnowledgeWorkspaceHandoffError;
} {
  return { ok: false, status: 'storage-error', error: { code, message } };
}

function invalidStoreResult(error: KnowledgeWorkspaceHandoffError): StoreKnowledgeWorkspaceHandoffResult {
  return { ok: false, status: 'invalid', error };
}

export function knowledgeWorkspaceHandoffStorageKey(userId: string): string {
  return `${HANDOFF_STORAGE_PREFIX}${encodeURIComponent(userId.trim())}`;
}

export function storeKnowledgeWorkspaceHandoff(
  input: KnowledgeWorkspaceHandoffInput,
  options: StoreKnowledgeWorkspaceHandoffOptions = {},
): StoreKnowledgeWorkspaceHandoffResult {
  const user = normalizeUserId(input?.userId);
  if (!user.ok) return invalidStoreResult(user.error);
  if (!isOrigin(input?.origin)) {
    return invalidStoreResult({ code: 'invalid-origin', message: '未知的知识交接来源。' });
  }
  if (!isIntent(input?.intent)) {
    return invalidStoreResult({ code: 'invalid-intent', message: '未知的知识工作意图。' });
  }
  const context = normalizeContext(input?.context);
  if (!context.ok) return invalidStoreResult(context.error);
  if (context.value.mode === 'selected') {
    const limitError = sourceLimitError(context.value.refs);
    if (limitError) return invalidStoreResult(limitError);
  }
  const prompt = normalizeDraftPrompt(input?.draftPrompt);
  if (!prompt.ok) return invalidStoreResult(prompt.error);

  const ttlMs = options.ttlMs ?? DEFAULT_KNOWLEDGE_HANDOFF_TTL_MS;
  if (
    !Number.isSafeInteger(ttlMs) ||
    ttlMs <= 0 ||
    ttlMs > MAX_KNOWLEDGE_HANDOFF_TTL_MS
  ) {
    return invalidStoreResult({
      code: 'invalid-ttl',
      message: '知识交接有效期必须大于 0 且不超过 30 分钟。',
    });
  }
  const now = resolveNow(options.now);
  if (!now.ok) return invalidStoreResult(now.error);

  const handoff: KnowledgeWorkspaceHandoff = {
    schemaVersion: 1,
    userId: user.value,
    origin: input.origin,
    intent: input.intent,
    context: context.value,
    ...(prompt.value === undefined ? {} : { draftPrompt: prompt.value }),
    createdAt: now.value,
    expiresAt: now.value + ttlMs,
  };
  if (!Number.isSafeInteger(handoff.expiresAt)) {
    return invalidStoreResult({ code: 'invalid-time', message: '知识交接有效时间超出支持范围。' });
  }

  const storage = resolveStorage(options.storage);
  if (!storage) {
    return storageError('storage-unavailable', '当前浏览器会话无法保存知识交接。');
  }
  const key = knowledgeWorkspaceHandoffStorageKey(user.value);
  try {
    storage.setItem(key, JSON.stringify(handoff));
  } catch {
    return storageError('storage-write-failed', '知识交接保存失败，请重试。');
  }
  return { ok: true, status: 'stored', key, handoff };
}

function validateStoredHandoff(
  value: unknown,
  expectedUserId: string,
): ValidationResult<KnowledgeWorkspaceHandoff> {
  if (!isRecord(value)) {
    return invalid('invalid-payload', '知识交接内容无效。');
  }
  if (value.schemaVersion !== 1) {
    return invalid('invalid-schema', '知识交接版本不受支持。');
  }
  const user = normalizeUserId(value.userId);
  if (!user.ok) return user;
  if (user.value !== expectedUserId) {
    return invalid('user-mismatch', '知识交接不属于当前用户。');
  }
  if (!isOrigin(value.origin)) {
    return invalid('invalid-origin', '知识交接来源无效。');
  }
  if (!isIntent(value.intent)) {
    return invalid('invalid-intent', '知识工作意图无效。');
  }
  const context = normalizeContext(value.context);
  if (!context.ok) return context;
  if (context.value.mode === 'selected') {
    const limitError = sourceLimitError(context.value.refs);
    if (limitError) return { ok: false, error: limitError };
  }
  const prompt = normalizeDraftPrompt(value.draftPrompt);
  if (!prompt.ok) return prompt;
  if (
    !Number.isSafeInteger(value.createdAt) ||
    (value.createdAt as number) < 0 ||
    !Number.isSafeInteger(value.expiresAt) ||
    (value.expiresAt as number) <= (value.createdAt as number) ||
    (value.expiresAt as number) - (value.createdAt as number) > MAX_KNOWLEDGE_HANDOFF_TTL_MS
  ) {
    return invalid('invalid-payload', '知识交接有效时间无效。');
  }
  return {
    ok: true,
    value: {
      schemaVersion: 1,
      userId: user.value,
      origin: value.origin,
      intent: value.intent,
      context: context.value,
      ...(prompt.value === undefined ? {} : { draftPrompt: prompt.value }),
      createdAt: value.createdAt as number,
      expiresAt: value.expiresAt as number,
    },
  };
}

export function consumeKnowledgeWorkspaceHandoff(
  userId: string,
  options: KnowledgeWorkspaceHandoffOptions = {},
): ConsumeKnowledgeWorkspaceHandoffResult {
  const user = normalizeUserId(userId);
  if (!user.ok) return { ok: false, status: 'invalid', error: user.error };
  const storage = resolveStorage(options.storage);
  if (!storage) {
    return storageError('storage-unavailable', '当前浏览器会话无法读取知识交接。');
  }
  const key = knowledgeWorkspaceHandoffStorageKey(user.value);
  let serialized: string | null;
  try {
    serialized = storage.getItem(key);
  } catch {
    return storageError('storage-read-failed', '知识交接读取失败，请重试。');
  }
  if (serialized === null) return { ok: true, status: 'empty' };

  // Remove before parsing or exposing the value. This makes the handoff one-use
  // under refreshes and React Strict Mode. If removal fails, fail closed.
  try {
    storage.removeItem(key);
  } catch {
    return storageError('storage-remove-failed', '无法安全消费知识交接，请重试。');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return {
      ok: false,
      status: 'invalid',
      error: { code: 'malformed-payload', message: '知识交接内容已损坏。' },
    };
  }
  const handoff = validateStoredHandoff(parsed, user.value);
  if (!handoff.ok) return { ok: false, status: 'invalid', error: handoff.error };
  const now = resolveNow(options.now);
  if (!now.ok) return { ok: false, status: 'invalid', error: now.error };
  if (handoff.value.expiresAt <= now.value) {
    return {
      ok: false,
      status: 'expired',
      error: { code: 'invalid-payload', message: '知识交接已过期，请重新选择来源。' },
    };
  }
  return { ok: true, status: 'consumed', handoff: handoff.value };
}

function adapterError(
  code: KnowledgeContextAdapterErrorCode,
  message: string,
): KnowledgeContextAdapterResult {
  return { ok: false, error: { code, message } };
}

function atlasScope(kpIds: number[], carrierIds: number[]): KnowledgeContextChatAtlasScope {
  return {
    kpIds,
    carrierIds,
    neighborhoodDepth: 1,
    includeEvidence: true,
    semanticRecall: true,
    semanticLimit: 8,
  };
}

export function adaptKnowledgeContextToChat(
  selection: KnowledgeContextSelection,
): KnowledgeContextAdapterResult {
  const normalized = normalizeContext(selection);
  if (!normalized.ok) {
    return adapterError(
      normalized.error.code === 'invalid-ref' ? 'invalid-ref' : 'invalid-selection',
      normalized.error.message,
    );
  }

  if (normalized.value.mode === 'auto') {
    // Deliberately do not create a kbIds property. The backend distinguishes
    // omitted (automatic KB injection) from null (explicitly no KB context).
    return { ok: true, value: { atlasScope: atlasScope([], []) } };
  }
  if (normalized.value.mode === 'none') {
    return { ok: true, value: { kbIds: null, atlasScope: null } };
  }

  const kbIds: number[] = [];
  const kpIds: number[] = [];
  const carrierIds: number[] = [];
  for (const ref of normalized.value.refs) {
    if (ref.kind === 'knowledge-base') kbIds.push(ref.id);
    if (ref.kind === 'atlas-kp') kpIds.push(ref.id);
    if (ref.kind === 'atlas-carrier') carrierIds.push(ref.id);
  }
  if (kbIds.length > MAX_KNOWLEDGE_BASE_REFS) {
    return adapterError(
      'kb-limit-exceeded',
      `最多可同时使用 ${MAX_KNOWLEDGE_BASE_REFS} 个知识库，请减少选择后重试。`,
    );
  }
  if (kpIds.length > MAX_ATLAS_KP_REFS) {
    return adapterError(
      'kp-limit-exceeded',
      `最多可同时使用 ${MAX_ATLAS_KP_REFS} 个知识点，请减少选择后重试。`,
    );
  }
  if (carrierIds.length > MAX_ATLAS_CARRIER_REFS) {
    return adapterError(
      'carrier-limit-exceeded',
      `最多可同时使用 ${MAX_ATLAS_CARRIER_REFS} 个来源载体，请减少选择后重试。`,
    );
  }

  return {
    ok: true,
    value: {
      kbIds: kbIds.length > 0 ? kbIds : null,
      atlasScope:
        kpIds.length > 0 || carrierIds.length > 0 ? atlasScope(kpIds, carrierIds) : null,
    },
  };
}
