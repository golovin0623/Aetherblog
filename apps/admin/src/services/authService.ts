import api from './api';
import { R, User, LoginRequest, LoginResponse } from '@/types';

/** JWT 签名密钥的安全元数据 (永不携带 secret_value 本身)。 */
export interface JwtSecretMeta {
  /** 当前 current 密钥的晋升时间 (RFC3339 字符串)。 */
  currentPromotedAt: string;
  /** 上一密钥被降级为 previous 的时间; 没有 previous 时为 null。 */
  previousDemotedAt: string | null;
  /** 上一密钥宽限期到期时间 (此后将被标为 retired); 没有 previous 时为 null。 */
  previousRetiresAt: string | null;
  /** 配置的自动轮换间隔 (天); 0 表示自动轮换已禁用。 */
  rotationIntervalDays: number;
  /** 配置的 previous 宽限期 (小时)。 */
  previousGraceHours: number;
}

/** POST /v1/admin/auth/rotate-jwt-secret 的响应。 */
export interface RotateJwtSecretResponse {
  /** 本次轮换发生的服务器时间 (RFC3339)。 */
  rotatedAt: string;
  /** 旧密钥在多少小时后会被彻底 retired。 */
  previousGraceHours: number;
}

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

  refreshToken: async (): Promise<R<LoginResponse>> => {
    return api.post<R<LoginResponse>>('/v1/auth/refresh');
  },

  changePassword: async (data: { currentPassword: string; newPassword: string }): Promise<R<void>> => {
    return api.post<R<void>>('/v1/auth/change-password', data);
  },

  updateProfile: async (data: { nickname?: string; email?: string }): Promise<R<User>> => {
    return api.put<R<User>>('/v1/auth/profile', data);
  },

  updateAvatar: async (avatarUrl: string): Promise<R<string>> => {
    return api.put<R<string>>('/v1/auth/avatar', { avatarUrl });
  },

  /** 拉取 JWT 签名密钥的安全元数据（永不回传 secret_value）。 */
  getJwtSecretMeta: async (): Promise<R<JwtSecretMeta>> => {
    return api.get<R<JwtSecretMeta>>('/v1/admin/auth/jwt-secret-meta');
  },

  /** 触发 JWT 签名密钥的计划外手动轮换（VULN-152 类应急响应使用）。 */
  rotateJwtSecret: async (): Promise<R<RotateJwtSecretResponse>> => {
    return api.post<R<RotateJwtSecretResponse>>('/v1/admin/auth/rotate-jwt-secret');
  },
};
