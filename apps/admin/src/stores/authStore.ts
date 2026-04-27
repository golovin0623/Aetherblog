import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface User {
  id: string;
  username: string;
  nickname: string;
  avatar: string;
  role: 'ADMIN' | 'EDITOR' | 'USER';
  email?: string;
}

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  login: (user: User, token?: string | null) => void;
  logout: () => void;
  updateUser: (user: Partial<User>) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      login: (user, token = null) =>
        set({ user, token, isAuthenticated: true }),
      logout: () =>
        set({ user: null, token: null, isAuthenticated: false }),
      updateUser: (updates) =>
        set((state) => ({
          user: state.user ? { ...state.user, ...updates } : null,
        })),
    }),
    {
      name: 'aetherblog-auth',
      // 安全 (VULN-095)：仅持久化"是否已登录"标志位。完整的用户记录——
      // 包括 `role`——在应用启动时通过 /v1/auth/me 重新获取，因此被修改
      // 的 localStorage 条目无法在 UI 中悄悄将账号提权为 ADMIN。（自
      // VULN-052 起后端已严格校验，此处保证 UI 表层逻辑一致。）
      partialize: (state) => ({
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);
