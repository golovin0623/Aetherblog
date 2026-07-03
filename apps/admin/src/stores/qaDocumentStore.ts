/**
 * QA 文档条件存储
 * 模式镜像 authStore.ts（在需要时创建+保留）
 * 参考：docs/features/qa-document-workflow.md §1、§3
 */

import { create } from 'zustand';
import type { QaDocument, CanonicalNode } from '@/types/qaDocument';

interface QaDocumentState {
  /** 当前查看的文档 */
  currentDocument: QaDocument | null;
  /** 当前文档的规范树 */
  tree: CanonicalNode[];
  /** 当前所选区块的stableKey（校对视图）*/
  selectedStableKey: string | null;
  /** 文档详情是否正在加载 */
  loading: boolean;
  /** 树是否正在加载 */
  treeLoading: boolean;
  /** 最后的错误信息 */
  error: string | null;

  // 行动
  setCurrentDocument: (doc: QaDocument | null) => void;
  setTree: (nodes: CanonicalNode[]) => void;
  setSelectedStableKey: (key: string | null) => void;
  setLoading: (v: boolean) => void;
  setTreeLoading: (v: boolean) => void;
  setError: (msg: string | null) => void;
  reset: () => void;
}

const initialState = {
  currentDocument: null,
  tree: [],
  selectedStableKey: null,
  loading: false,
  treeLoading: false,
  error: null,
};

export const useQaDocumentStore = create<QaDocumentState>()((set) => ({
  ...initialState,

  setCurrentDocument: (doc) => set({ currentDocument: doc }),
  setTree: (nodes) => set({ tree: nodes }),
  setSelectedStableKey: (key) => set({ selectedStableKey: key }),
  setLoading: (v) => set({ loading: v }),
  setTreeLoading: (v) => set({ treeLoading: v }),
  setError: (msg) => set({ error: msg }),
  reset: () => set(initialState),
}));
