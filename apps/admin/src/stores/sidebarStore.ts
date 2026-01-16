import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SidebarState {
  isCollapsed: boolean; // 持久化用户偏好
  isAutoCollapsed: boolean; // 临时覆盖 (例如：专注模式)
  isMobileOpen: boolean; // 移动端抽屉状态
  toggle: () => void;
  toggleMobile: () => void;
  setCollapsed: (collapsed: boolean) => void;
  setAutoCollapse: (auto: boolean) => void;
  setMobileOpen: (open: boolean) => void;
}

export const useSidebarStore = create<SidebarState>()(
  persist(
    (set) => ({
      isCollapsed: false,
      isAutoCollapsed: false,
      isMobileOpen: false, // 移动端抽屉默认关闭
      
      toggle: () => set((state) => {
        // 当前可见状态是偏好和自动覆盖的组合
        const isCurrentlyCollapsed = state.isCollapsed || state.isAutoCollapsed;
        return { 
          isCollapsed: !isCurrentlyCollapsed,
          // 用户手动切换后，清除当前会话的自动覆盖
          isAutoCollapsed: false 
        };
      }),

      toggleMobile: () => set((state) => ({ isMobileOpen: !state.isMobileOpen })),
      setMobileOpen: (open) => set({ isMobileOpen: open }),

      setCollapsed: (collapsed) => set({ isCollapsed: collapsed, isAutoCollapsed: false }),
      setAutoCollapse: (auto) => set({ isAutoCollapsed: auto }),
    }),
    {
      name: 'sidebar-storage',
      // 仅持久化手动用户偏好
      partialize: (state) => ({ isCollapsed: state.isCollapsed }),
    }
  )
);
