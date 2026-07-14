import {
  adaptKnowledgeContextToChat,
  type KnowledgeContextAdapterResult,
  type KnowledgeContextChatAtlasScope,
  type KnowledgeContextSelection,
  type KnowledgeWorkspaceHandoff,
} from '@/services/knowledgeWorkspaceHandoff';
import type { AgentRequestSnapshotV1 } from '@/services/agent';

interface KnowledgeBaseSelectionLike {
  id: number;
  name: string;
}

interface AtlasKnowledgePointSelectionLike {
  id: number;
  title: string;
}

export interface SessionKnowledgeHandoff {
  sessionId: string;
  handoff: KnowledgeWorkspaceHandoff;
}

export type AetherHubKnowledgeContextResult =
  | {
      ok: true;
      value: AetherHubKnowledgeContextPayload;
    }
  | Extract<KnowledgeContextAdapterResult, { ok: false }>;

type AetherHubAtlasScope = Omit<
  KnowledgeContextChatAtlasScope,
  'semanticRecall' | 'neighborhoodDepth'
> & {
  semanticRecall: boolean;
  neighborhoodDepth: 0 | 1;
};

type AetherHubKnowledgeContextPayload = {
  knowledgeContextMode: KnowledgeContextSelection['mode'];
  kbIds?: number[] | null;
  atlasScope: AetherHubAtlasScope | null;
};

export type AetherHubRequestSnapshotResult =
  | { status: 'missing' }
  | { status: 'valid'; snapshot: AgentRequestSnapshotV1 }
  | { status: 'invalid'; message: string };

const INVALID_REQUEST_SNAPSHOT_MESSAGE =
  '历史请求的知识范围已损坏或版本不受支持，无法安全重试。';

function adaptAetherHubKnowledgeContext(
  selection: KnowledgeContextSelection,
): AetherHubKnowledgeContextResult {
  const adapted = adaptKnowledgeContextToChat(selection);
  if (!adapted.ok) return adapted;
  const atlasScope =
    selection.mode === 'selected' && adapted.value.atlasScope
      ? {
          ...adapted.value.atlasScope,
          neighborhoodDepth: 0 as const,
          semanticRecall: false,
        }
      : adapted.value.atlasScope;
  return {
    ok: true,
    value: {
      ...adapted.value,
      atlasScope,
      knowledgeContextMode: selection.mode,
    },
  };
}

function cloneKnowledgeContextSelection(
  selection: KnowledgeContextSelection,
): KnowledgeContextSelection {
  if (selection.mode !== 'selected') return { mode: selection.mode };
  return {
    mode: 'selected',
    refs: selection.refs.map((ref) => ({ ...ref })),
  };
}

function normalizeSnapshotIds(value: unknown): number[] | null | undefined {
  if (value === null) return null;
  if (!Array.isArray(value)) return undefined;
  if (!value.every((item) => Number.isSafeInteger(item) && item > 0)) return undefined;
  return value.length > 0 ? [...new Set(value as number[])] : null;
}

function normalizeSnapshotTags(value: unknown): string[] | null | undefined {
  if (value === null) return null;
  if (!Array.isArray(value)) return undefined;
  if (!value.every((item) => typeof item === 'string' && item.trim().length > 0)) {
    return undefined;
  }
  const tags = [...new Set((value as string[]).map((item) => item.trim()))];
  return tags.length > 0 ? tags : null;
}

export function createAetherHubRequestSnapshot(
  knowledgeContext: KnowledgeContextSelection,
  articleIds: readonly number[],
  tagSlugs: readonly string[],
): AgentRequestSnapshotV1 {
  return {
    schemaVersion: 1,
    knowledgeContext: cloneKnowledgeContextSelection(knowledgeContext),
    articleIds: articleIds.length > 0 ? [...articleIds] : null,
    tagSlugs: tagSlugs.length > 0 ? [...tagSlugs] : null,
  };
}

export function readAetherHubRequestSnapshot(message: unknown): AetherHubRequestSnapshotResult {
  const candidate =
    message && typeof message === 'object' && !Array.isArray(message)
      ? (message as Record<string, unknown>).requestSnapshot
      : undefined;
  if (candidate === undefined) return { status: 'missing' };
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return { status: 'invalid', message: INVALID_REQUEST_SNAPSHOT_MESSAGE };
  }
  const value = candidate as Record<string, unknown>;
  if (value.schemaVersion !== 1) {
    return { status: 'invalid', message: INVALID_REQUEST_SNAPSHOT_MESSAGE };
  }

  const knowledgeContext = value.knowledgeContext as KnowledgeContextSelection;
  const resolved = adaptAetherHubKnowledgeContext(knowledgeContext);
  const articleIds = normalizeSnapshotIds(value.articleIds);
  const tagSlugs = normalizeSnapshotTags(value.tagSlugs);
  if (!resolved.ok || articleIds === undefined || tagSlugs === undefined) {
    return { status: 'invalid', message: INVALID_REQUEST_SNAPSHOT_MESSAGE };
  }

  return {
    status: 'valid',
    snapshot: {
      schemaVersion: 1,
      knowledgeContext: cloneKnowledgeContextSelection(knowledgeContext),
      articleIds,
      tagSlugs,
    },
  };
}

/**
 * A successful request consumes only the source selection that request sent.
 * Functional React state setters pass the latest selection here, so edits made
 * while the answer is streaming survive when they no longer match the snapshot.
 */
export function preserveContextSelectionAfterSuccess<T, K extends PropertyKey>(
  current: T[],
  sent: readonly T[],
  keyOf: (item: T) => K,
): T[] {
  return preserveContextSelectionKeysAfterSuccess(
    current,
    sent.map((item) => keyOf(item)),
    keyOf,
  );
}

export function preserveContextSelectionKeysAfterSuccess<T, K extends PropertyKey>(
  current: T[],
  sentKeys: readonly K[],
  keyOf: (item: T) => K,
): T[] {
  const currentKeys = current.map((item) => keyOf(item));
  const currentKeySet = new Set(currentKeys);
  const sentKeySet = new Set(sentKeys);
  const unchanged =
    currentKeys.length === sentKeys.length &&
    currentKeySet.size === sentKeySet.size &&
    currentKeys.every((key) => sentKeySet.has(key));
  return unchanged ? [] : current;
}

/**
 * A one-use handoff belongs to the fresh AetherHub session created for it.
 * Returning null for every other session prevents explicit selected/none
 * context from leaking into an unrelated conversation.
 */
export function getSessionKnowledgeHandoff(
  current: SessionKnowledgeHandoff | null,
  sessionId: string | null,
): SessionKnowledgeHandoff | null {
  return current && sessionId && current.sessionId === sessionId ? current : null;
}

export function clearSessionKnowledgeHandoff(
  current: SessionKnowledgeHandoff | null,
  sessionId: string | null,
): SessionKnowledgeHandoff | null {
  return getSessionKnowledgeHandoff(current, sessionId) ? null : current;
}

/** Reference identity preserves a newer session handoff created while sending. */
export function preserveSessionKnowledgeHandoffAfterSuccess(
  current: SessionKnowledgeHandoff | null,
  sent: SessionKnowledgeHandoff | null,
): SessionKnowledgeHandoff | null {
  return current === sent ? null : current;
}

export function selectAetherHubKnowledgeContext(
  handoffContext: KnowledgeContextSelection | null,
  knowledgeBases: readonly KnowledgeBaseSelectionLike[],
  knowledgePoints: readonly AtlasKnowledgePointSelectionLike[],
): KnowledgeContextSelection {
  if (handoffContext) return handoffContext;
  if (knowledgeBases.length === 0 && knowledgePoints.length === 0) return { mode: 'auto' };
  return {
    mode: 'selected',
    refs: [
      ...knowledgeBases.map((kb) => ({
        kind: 'knowledge-base' as const,
        id: kb.id,
        label: kb.name,
      })),
      ...knowledgePoints.map((kp) => ({
        kind: 'atlas-kp' as const,
        id: kp.id,
        label: kp.title,
      })),
    ],
  };
}

/**
 * Workbench handoffs are explicit user intent and therefore take precedence.
 * Without a handoff, picker values are explicit selections; an empty picker is
 * automatic discovery, not an instruction to disable knowledge.
 */
export function resolveAetherHubKnowledgeContext(
  handoffContext: KnowledgeContextSelection | null,
  knowledgeBases: readonly KnowledgeBaseSelectionLike[],
  knowledgePoints: readonly AtlasKnowledgePointSelectionLike[],
): AetherHubKnowledgeContextResult {
  return adaptAetherHubKnowledgeContext(
    selectAetherHubKnowledgeContext(handoffContext, knowledgeBases, knowledgePoints),
  );
}
