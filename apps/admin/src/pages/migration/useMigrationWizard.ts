import { useReducer, useCallback } from 'react';
import type {
  AnalysisReport,
  ExecutionSummary,
  ImportOptions,
  ProgressEvent,
} from '@/services/migrationService';

/** 5 步向导的阶段枚举。 */
export type WizardStep = 'upload' | 'options' | 'preview' | 'execute' | 'summary';

export interface ProgressPhaseState {
  name: string;
  total: number;
  done: number;
}

export interface WizardState {
  step: WizardStep;
  file: File | null;
  /** 客户端快速解析出的 backup 概览（用于 StepUpload 的确认卡片）。 */
  filePreview: {
    articles: number;
    drafts: number;
    categories: number;
    tags: number;
    sizeKB: number;
  } | null;
  options: ImportOptions;
  selectedArticleIds: Set<number> | null; // null = 全选
  analysis: AnalysisReport | null;
  analyzing: boolean;
  analyzeError: string | null;

  /** Execute 阶段累积状态 —— 每个事件实时聚合到 phases + recentItems + summary。 */
  phases: Record<string, ProgressPhaseState>;
  currentPhase: string | null;
  recentItems: Array<{ kind: string; title?: string; action?: string; postId?: number; error?: string; sourceId?: string }>;
  summary: ExecutionSummary | null;
  fatalError: string | null;
  executing: boolean;
}

const initialState: WizardState = {
  step: 'upload',
  file: null,
  filePreview: null,
  options: {
    conflictStrategy: 'skip',
    preserveTimestamps: true,
    importHidden: true,
    importDrafts: true,
    importDeleted: false,
    preservePasswords: true,
  },
  selectedArticleIds: null,
  analysis: null,
  analyzing: false,
  analyzeError: null,
  phases: {},
  currentPhase: null,
  recentItems: [],
  summary: null,
  fatalError: null,
  executing: false,
};

type Action =
  | { type: 'setFile'; file: File; preview: WizardState['filePreview'] }
  | { type: 'clearFile' }
  | { type: 'setOptions'; options: Partial<ImportOptions> }
  | { type: 'setStep'; step: WizardStep }
  | { type: 'setSelectedIds'; ids: Set<number> | null }
  | { type: 'analyzeStart' }
  | { type: 'analyzeSuccess'; analysis: AnalysisReport }
  | { type: 'analyzeFailure'; error: string }
  | { type: 'executeStart' }
  | { type: 'executeEvent'; event: ProgressEvent }
  | { type: 'executeEnd' }
  | { type: 'reset' };

function reducer(state: WizardState, action: Action): WizardState {
  switch (action.type) {
    case 'setFile':
      return { ...state, file: action.file, filePreview: action.preview, analysis: null, analyzeError: null };
    case 'clearFile':
      return { ...state, file: null, filePreview: null, analysis: null };
    case 'setOptions':
      return { ...state, options: { ...state.options, ...action.options } };
    case 'setStep':
      return { ...state, step: action.step };
    case 'setSelectedIds':
      return { ...state, selectedArticleIds: action.ids };
    case 'analyzeStart':
      return { ...state, analyzing: true, analyzeError: null };
    case 'analyzeSuccess':
      return { ...state, analyzing: false, analysis: action.analysis };
    case 'analyzeFailure':
      return { ...state, analyzing: false, analyzeError: action.error };
    case 'executeStart':
      return {
        ...state,
        executing: true,
        phases: {},
        currentPhase: null,
        recentItems: [],
        summary: null,
        fatalError: null,
      };
    case 'executeEvent':
      return applyEvent(state, action.event);
    case 'executeEnd':
      return { ...state, executing: false };
    case 'reset':
      return initialState;
    default:
      return state;
  }
}

function applyEvent(state: WizardState, ev: ProgressEvent): WizardState {
  switch (ev.type) {
    case 'phase': {
      const name = ev.phase || 'unknown';
      if (name === 'start' || name === 'done') {
        return { ...state, currentPhase: name };
      }
      const prev = state.phases[name] || { name, total: 0, done: 0 };
      return {
        ...state,
        currentPhase: name,
        phases: { ...state.phases, [name]: { ...prev, total: ev.total || prev.total } },
      };
    }
    case 'item': {
      // 累积单条进度。截断保留最近 80 条，避免大备份把 UI 撑爆。
      const item = {
        kind: ev.kind || '',
        title: ev.title,
        action: ev.action,
        postId: ev.postId,
        error: ev.error,
        sourceId: ev.sourceId,
      };
      const next = [...state.recentItems.slice(-79), item];
      // 同步把当前阶段的 done 递增。
      const ph = state.currentPhase;
      if (!ph || ph === 'start' || ph === 'done') {
        return { ...state, recentItems: next };
      }
      const prev = state.phases[ph] || { name: ph, total: 0, done: 0 };
      return {
        ...state,
        recentItems: next,
        phases: { ...state.phases, [ph]: { ...prev, done: prev.done + 1 } },
      };
    }
    case 'summary':
      return { ...state, summary: ev.summary || null };
    case 'fatal':
      return { ...state, fatalError: ev.error || '未知错误', executing: false };
    default:
      return state;
  }
}

export function useMigrationWizard() {
  const [state, dispatch] = useReducer(reducer, initialState);

  const setFile = useCallback((file: File | null) => {
    if (!file) {
      dispatch({ type: 'clearFile' });
      return;
    }
    // 客户端轻量解析 JSON 抓个概览（让用户看到确认卡片再决定是否上传）。
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || '{}'));
        const preview = {
          articles: Array.isArray(parsed.articles) ? parsed.articles.length : 0,
          drafts: Array.isArray(parsed.drafts) ? parsed.drafts.length : 0,
          categories: Array.isArray(parsed.categories) ? parsed.categories.length : 0,
          tags: Array.isArray(parsed.tags) ? parsed.tags.length : 0,
          sizeKB: Math.round(file.size / 1024),
        };
        dispatch({ type: 'setFile', file, preview });
      } catch {
        // 文件不是合法 JSON：仍然允许上传（server 会返回具体错误），预览置 null。
        dispatch({ type: 'setFile', file, preview: null });
      }
    };
    reader.readAsText(file);
  }, []);

  return {
    state,
    setFile,
    setOptions: (o: Partial<ImportOptions>) => dispatch({ type: 'setOptions', options: o }),
    setStep: (s: WizardStep) => dispatch({ type: 'setStep', step: s }),
    setSelectedIds: (ids: Set<number> | null) => dispatch({ type: 'setSelectedIds', ids }),
    analyzeStart: () => dispatch({ type: 'analyzeStart' }),
    analyzeSuccess: (a: AnalysisReport) => dispatch({ type: 'analyzeSuccess', analysis: a }),
    analyzeFailure: (e: string) => dispatch({ type: 'analyzeFailure', error: e }),
    executeStart: () => dispatch({ type: 'executeStart' }),
    executeEvent: (e: ProgressEvent) => dispatch({ type: 'executeEvent', event: e }),
    executeEnd: () => dispatch({ type: 'executeEnd' }),
    reset: () => dispatch({ type: 'reset' }),
  };
}
