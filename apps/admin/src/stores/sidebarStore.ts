import { create } from 'zustand';

interface SidebarState {
  isCollapsed: boolean;
  isAutoCollapsed: boolean;
  toggle: () => void;
  setCollapsed: (collapsed: boolean) => void;
  setAutoCollapse: (auto: boolean) => void;
}

export const useSidebarStore = create<SidebarState>((set) => ({
  isCollapsed: false,
  isAutoCollapsed: false,
  toggle: () => set((state) => ({ isCollapsed: !state.isCollapsed, isAutoCollapsed: false })),
  setCollapsed: (collapsed) => set({ isCollapsed: collapsed, isAutoCollapsed: false }),
  setAutoCollapse: (auto) => set({ isCollapsed: auto, isAutoCollapsed: auto }),
}));
