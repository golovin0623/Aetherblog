import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SidebarState {
  isCollapsed: boolean; // Persistent user preference
  isAutoCollapsed: boolean; // Temporary override (e.g. Focus Mode)
  toggle: () => void;
  setCollapsed: (collapsed: boolean) => void;
  setAutoCollapse: (auto: boolean) => void;
}

export const useSidebarStore = create<SidebarState>()(
  persist(
    (set) => ({
      isCollapsed: false,
      isAutoCollapsed: false,
      toggle: () => set((state) => {
        // Current visible state is a combination of preference and auto-override
        const isCurrentlyCollapsed = state.isCollapsed || state.isAutoCollapsed;
        return { 
          isCollapsed: !isCurrentlyCollapsed,
          // Once user manually toggles, we clear the auto-override for this session
          isAutoCollapsed: false 
        };
      }),
      setCollapsed: (collapsed) => set({ isCollapsed: collapsed, isAutoCollapsed: false }),
      setAutoCollapse: (auto) => set({ isAutoCollapsed: auto }),
    }),
    {
      name: 'sidebar-storage',
      // Only persist manual user preference
      partialize: (state) => ({ isCollapsed: state.isCollapsed }),
    }
  )
);
