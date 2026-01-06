import api from './api';
import { R, User, LoginRequest, LoginResponse } from '@/types';

export const authService = {
  login: async (data: LoginRequest): Promise<R<LoginResponse>> => {
    return api.post<R<LoginResponse>>('/v1/auth/login', data);
  },

  logout: async (): Promise<R<void>> => {
    return api.post<R<void>>('/v1/auth/logout');
  },

  getCurrentUser: async (): Promise<R<User>> => {
    return api.get<R<User>>('/v1/auth/me');
  },

  refreshToken: async (refreshToken: string): Promise<R<LoginResponse>> => {
    return api.post<R<LoginResponse>>('/v1/auth/refresh', { refreshToken });
  },

  changePassword: async (data: { currentPassword: string; newPassword: string; encrypted?: boolean }): Promise<R<void>> => {
    return api.post<R<void>>('/v1/auth/change-password', data);
  },
};
