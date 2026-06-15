/**
 * QA Document Zustand store
 * Pattern mirrors authStore.ts (create + persist where needed)
 * ref: docs/features/qa-document-workflow.md §1, §3
 */

import { create } from 'zustand';
import type { QaDocument, CanonicalNode } from '@/types/qaDocument';

interface QaDocumentState {
  /** Currently viewed document */
  currentDocument: QaDocument | null;
  /** Canonical tree for the current document */
  tree: CanonicalNode[];
  /** stableKey of the currently selected block (proofread view) */
  selectedStableKey: string | null;
  /** Whether the document detail is loading */
  loading: boolean;
  /** Whether the tree is loading */
  treeLoading: boolean;
  /** Last error message */
  error: string | null;

  // Actions
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
