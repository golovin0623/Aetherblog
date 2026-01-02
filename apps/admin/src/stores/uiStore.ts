import { create } from 'zustand';

interface UIStore {
  isSidebarCollapsed: boolean;
  isLoading: boolean;
  theme: 'dark' | 'light';
  
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setLoading: (loading: boolean) => void;
  setTheme: (theme: 'dark' | 'light') => void;
}

export const useUIStore = create<UIStore>((set) => ({
  isSidebarCollapsed: false,
  isLoading: false,
  theme: 'dark',
  
  toggleSidebar: () => set((state) => ({ isSidebarCollapsed: !state.isSidebarCollapsed })),
  setSidebarCollapsed: (isSidebarCollapsed) => set({ isSidebarCollapsed }),
  setLoading: (isLoading) => set({ isLoading }),
  setTheme: (theme) => set({ theme }),
}));
