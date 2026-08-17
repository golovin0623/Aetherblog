import { describe, expect, it } from 'vitest';
import type { AtlasSearchResponse } from '@aetherblog/types';
import type { KnowledgeBaseRetrievalResponse } from '@/services/knowledgeBaseService';
import type { NoteListItem } from '@/types/note';
import {
  MAX_KB_RETRIEVAL_TARGETS,
  buildAskSeed,
  buildAtlasAtoms,
  buildKbAtoms,
  buildNoteAtoms,
  isKnowledgeBaseQueryable,
  normalizeRetrievalScore,
  planKbRetrievalTargets,
  rankAtoms,
  resolveAtlasLaneOutcome,
  resolveKbLaneOutcome,
  resolveNotesLaneOutcome,
  stripMarkdownLite,
  type KbRetrievalTarget,
} from './unifiedRetrievalModel';

import type { QueryableKnowledgeBaseInput } from './unifiedRetrievalModel';

const readyKbFields: QueryableKnowledgeBaseInput = {
  kind: 'CUSTOM',
  fileCount: 2,
  vectorizedCount: 2,
  failedCount: 0,
  chunkCount: 8,
  activeProfileId: 7,
  activeProfile: null,
  effectivePermission: 'USE',
};

function makePlanInput(id: number, updatedAt: string, overrides: Partial<typeof readyKbFields> = {}) {
  return {
    id,
    slug: `kb-${id}`,
    name: `知识库 ${id}`,
    updatedAt,
    ...readyKbFields,
    ...overrides,
  };
}

describe('knowledge base queryability', () => {
  it('requires USE permission as well as index readiness', () => {
    expect(isKnowledgeBaseQueryable({ ...readyKbFields, effectivePermission: 'VIEW' })).toBe(false);
    expect(isKnowledgeBaseQueryable(readyKbFields)).toBe(true);
    expect(
      isKnowledgeBaseQueryable({ ...readyKbFields, effectivePermission: 'MANAGE', vectorizedCount: 1 }),
    ).toBe(false);
  });
});

describe('kb fan-out planning', () => {
  it('keeps only queryable bases, most recently active first', () => {
    const plan = planKbRetrievalTargets([
      makePlanInput(1, '2026-01-01T00:00:00Z'),
      makePlanInput(2, '2026-06-01T00:00:00Z'),
      makePlanInput(3, '2026-03-01T00:00:00Z', { effectivePermission: 'VIEW' }),
    ]);
    expect(plan.targets.map((target) => target.id)).toEqual([2, 1]);
    expect(plan.skippedReadyCount).toBe(0);
  });

  it('caps the fan-out and reports skipped ready bases instead of silently truncating', () => {
    const bases = Array.from({ length: MAX_KB_RETRIEVAL_TARGETS + 3 }, (_, index) =>
      makePlanInput(index + 1, `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00Z`),
    );
    const plan = planKbRetrievalTargets(bases);
    expect(plan.targets).toHaveLength(MAX_KB_RETRIEVAL_TARGETS);
    expect(plan.skippedReadyCount).toBe(3);
  });

  it('tolerates unparsable timestamps without throwing', () => {
    const plan = planKbRetrievalTargets([
      makePlanInput(1, 'not-a-date'),
      makePlanInput(2, '2026-06-01T00:00:00Z'),
    ]);
    expect(plan.targets[0]?.id).toBe(2);
  });
});

describe('score normalization', () => {
  it('accepts only the 0..1 scale and rejects unknown magnitudes', () => {
    expect(normalizeRetrievalScore(0.82)).toBe(0.82);
    expect(normalizeRetrievalScore(0)).toBe(0);
    expect(normalizeRetrievalScore(1)).toBe(1);
    expect(normalizeRetrievalScore(1.2)).toBeNull();
    expect(normalizeRetrievalScore(-0.1)).toBeNull();
    expect(normalizeRetrievalScore(Number.NaN)).toBeNull();
    expect(normalizeRetrievalScore('0.9')).toBeNull();
    expect(normalizeRetrievalScore(undefined)).toBeNull();
  });
});

describe('atom builders', () => {
  const target: KbRetrievalTarget = { id: 5, slug: 'product-kb', name: '产品知识库' };

  it('maps kb hits into pinnable atoms with provenance', () => {
    const response: KnowledgeBaseRetrievalResponse = {
      status: 'matched',
      query: 'RAG',
      hits: [
        { title: '检索架构', snippet: 'pgvector 提供语义召回。', score: 0.91, fileId: 3, chunkIndex: 2 },
      ],
    };
    const atoms = buildKbAtoms(target, response);
    expect(atoms).toHaveLength(1);
    expect(atoms[0]).toMatchObject({
      key: 'kb:5:3:2',
      kind: 'kb-chunk',
      title: '检索架构',
      score: 0.91,
      sourceLabel: '产品知识库 · 片段 3',
      href: '/intelligence/knowledge/product-kb',
      pinRef: { kind: 'knowledge-base', id: 5, label: '产品知识库' },
    });
  });

  it('returns no atoms for empty or unavailable retrieval outcomes', () => {
    expect(
      buildKbAtoms(target, { status: 'empty', query: 'q', hits: [] }),
    ).toHaveLength(0);
    expect(
      buildKbAtoms(target, { status: 'unavailable', query: 'q', hits: [] }),
    ).toHaveLength(0);
  });

  it('maps atlas knowledge points with evidence and keeps carriers view-only', () => {
    const response = {
      query: 'q',
      limit: 8,
      total: 3,
      semanticEnabled: true,
      semanticAvailable: true,
      knowledgePoints: [
        {
          id: 11,
          uuid: 'u',
          title: '知识原子化',
          bodyMarkdown: '# 标题\n**要点**:拆分为最小可引用单元。',
          type: 'concept',
          confidence: 0.8,
          status: 'growing',
          provenance: 'user',
          archived: false,
          createdAt: '',
          updatedAt: '',
          searchScore: 0.77,
          evidencePreview: {
            annotationId: 1,
            carrierId: 2,
            carrierType: 'pdf',
            carrierTitle: '知识管理手册',
            quote: '原子化让引用可验证。',
          },
        },
      ],
      annotations: [],
      carriers: [
        {
          id: 2,
          type: 'pdf',
          sourceUri: 'media://9',
          contentHash: 'h',
          title: '知识管理手册',
          metadata: {},
          status: 'ready',
          createdAt: '',
          updatedAt: '',
        },
      ],
    } as unknown as AtlasSearchResponse;

    const atoms = buildAtlasAtoms(response);
    const kp = atoms.find((atom) => atom.kind === 'atlas-kp');
    const carrier = atoms.find((atom) => atom.kind === 'atlas-carrier');
    expect(kp).toMatchObject({
      key: 'atlas-kp:11',
      score: 0.77,
      href: '/atlas/kp/11',
      pinRef: { kind: 'atlas-kp', id: 11, label: '知识原子化' },
      quote: '原子化让引用可验证。',
    });
    expect(kp?.snippet).not.toContain('#');
    expect(kp?.snippet).not.toContain('**');
    expect(kp?.sourceLabel).toContain('概念');
    expect(carrier).toMatchObject({
      pinRef: null,
      href: '/atlas/reader/pdf/2',
    });
  });

  it('maps notes as view-only atoms linking to the editor', () => {
    const notes = [
      {
        id: 7,
        title: '会议纪要',
        summary: '确认了向量检索的阈值。',
        folderName: '工作',
        tagNames: [],
        sourceType: 'manual',
        isPinned: false,
        isFavorite: false,
        archived: false,
        wordCount: 120,
        embeddingStatus: 'ready',
        createdAt: '',
        updatedAt: '',
      },
    ] as unknown as NoteListItem[];
    expect(buildNoteAtoms(notes)[0]).toMatchObject({
      key: 'note:7',
      href: '/notes/7/edit',
      sourceLabel: '笔记 · 工作',
      pinRef: null,
    });
  });
});

describe('lane outcomes', () => {
  const target = (id: number): KbRetrievalTarget => ({ id, slug: `kb-${id}`, name: `库${id}` });
  const matched = (score: number): KnowledgeBaseRetrievalResponse => ({
    status: 'matched',
    query: 'q',
    hits: [{ title: 't', snippet: 's', score, fileId: 1, chunkIndex: 0 }],
  });

  it('reports partial kb failures as degraded with the failing bases named', () => {
    const outcome = resolveKbLaneOutcome(
      [
        { target: target(1), ok: true, response: matched(0.9) },
        { target: target(2), ok: false },
      ],
      0,
    );
    expect(outcome.state).toBe('degraded');
    expect(outcome.detail).toContain('库2');
    expect(outcome.atoms).toHaveLength(1);
  });

  it('reports a full kb failure as an error, never as empty results', () => {
    const outcome = resolveKbLaneOutcome([{ target: target(1), ok: false }], 0);
    expect(outcome.state).toBe('error');
    expect(outcome.atoms).toHaveLength(0);
  });

  it('surfaces the fan-out cap in the lane detail', () => {
    const outcome = resolveKbLaneOutcome(
      [{ target: target(1), ok: true, response: matched(0.5) }],
      4,
    );
    expect(outcome.state).toBe('ready');
    expect(outcome.detail).toContain('4 个就绪库未参与');
  });

  it('marks the atlas lane degraded when semantic search fell back to keywords', () => {
    const outcome = resolveAtlasLaneOutcome({
      ok: true,
      response: {
        query: 'q',
        limit: 8,
        total: 1,
        semanticEnabled: true,
        semanticAvailable: false,
        knowledgePoints: [
          {
            id: 1,
            uuid: 'u',
            title: 'T',
            bodyMarkdown: 'b',
            type: 'claim',
            confidence: 1,
            status: 'seed',
            provenance: 'user',
            archived: false,
            createdAt: '',
            updatedAt: '',
          },
        ],
        annotations: [],
        carriers: [],
      } as unknown as AtlasSearchResponse,
    });
    expect(outcome.state).toBe('degraded');
    expect(outcome.detail).toContain('语义检索暂不可用');
  });

  it('turns lane rejections into explicit error states', () => {
    expect(resolveAtlasLaneOutcome({ ok: false }).state).toBe('error');
    expect(resolveNotesLaneOutcome({ ok: false }).state).toBe('error');
  });
});

describe('ranking and ask seed', () => {
  it('ranks scored atoms first and keeps unscored order stable', () => {
    const atom = (key: string, score: number | null) => ({
      key,
      lane: 'kb' as const,
      kind: 'kb-chunk' as const,
      title: key,
      snippet: '',
      score,
      sourceLabel: '',
      href: null,
      pinRef: null,
      quote: null,
    });
    const ranked = rankAtoms([atom('a', null), atom('b', 0.4), atom('c', 0.9), atom('d', null)]);
    expect(ranked.map((item) => item.key)).toEqual(['c', 'b', 'a', 'd']);
  });

  it('builds an ask seed that quotes the source and leaves the question open', () => {
    const seed = buildAskSeed({
      title: '检索架构',
      sourceLabel: '产品知识库 · 片段 3',
      quote: 'pgvector 提供语义召回。',
      snippet: '备选摘要',
    });
    expect(seed).toContain('检索架构');
    expect(seed).toContain('pgvector 提供语义召回。');
    expect(seed.endsWith('我想确认:')).toBe(true);
    expect(seed.length).toBeLessThanOrEqual(600);
  });

  it('strips markdown noise without dropping the text', () => {
    expect(stripMarkdownLite('# 标题\n> 引用**加粗**与 [链接](https://a.b)')).toBe(
      '标题 引用加粗与 链接',
    );
  });
});
