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
      // SECURITY (VULN-095): persist only the "am I logged in?" bit. The full
      // user record — including `role` — is re-fetched via /v1/auth/me on app
      // boot, so a modified localStorage entry cannot silently elevate an
      // account to ADMIN in the UI. (Backend enforcement is already strict
      // since VULN-052, but this keeps the UI's surface consistent.)
      partialize: (state) => ({
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);
