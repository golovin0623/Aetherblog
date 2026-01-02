import api from './api';
import { R, User, LoginRequest, LoginResponse } from '@/types';

export const authService = {
  login: async (data: LoginRequest): Promise<R<LoginResponse>> => {
    const response = await api.post<R<LoginResponse>>('/v1/auth/login', data);
    return response.data;
  },

  logout: async (): Promise<R<void>> => {
    const response = await api.post<R<void>>('/v1/auth/logout');
    return response.data;
  },

  getCurrentUser: async (): Promise<R<User>> => {
    const response = await api.get<R<User>>('/v1/auth/me');
    return response.data;
  },

  refreshToken: async (refreshToken: string): Promise<R<LoginResponse>> => {
    const response = await api.post<R<LoginResponse>>('/v1/auth/refresh', { refreshToken });
    return response.data;
  },
};
