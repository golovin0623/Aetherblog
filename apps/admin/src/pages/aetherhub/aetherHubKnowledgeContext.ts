import {
  adaptKnowledgeContextToChat,
  type KnowledgeContextAdapterResult,
  type KnowledgeContextChatAtlasScope,
  type KnowledgeContextSelection,
  type KnowledgeWorkspaceHandoff,
} from '@/services/knowledgeWorkspaceHandoff';

interface KnowledgeBaseSelectionLike {
  id: number;
  name: string;
}

interface AtlasKnowledgePointSelectionLike {
  id: number;
  title: string;
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
  const unchanged =
    current.length === sent.length &&
    current.every((item, index) => Object.is(keyOf(item), keyOf(sent[index])));
  return unchanged ? [] : current;
}

/**
 * Handoffs are immutable snapshots. Reference identity deliberately makes this
 * fail-safe: a newly arrived handoff is retained even when it has similar data.
 */
export function preserveKnowledgeHandoffAfterSuccess(
  current: KnowledgeWorkspaceHandoff | null,
  sent: KnowledgeWorkspaceHandoff | null,
): KnowledgeWorkspaceHandoff | null {
  return current === sent ? null : current;
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
  if (handoffContext) return adaptAetherHubKnowledgeContext(handoffContext);

  if (knowledgeBases.length === 0 && knowledgePoints.length === 0) {
    return adaptAetherHubKnowledgeContext({ mode: 'auto' });
  }

  return adaptAetherHubKnowledgeContext({
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
  });
}
