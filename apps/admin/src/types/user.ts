// 用户类型定义
export interface User {
  id: number;
  username: string;
  nickname: string;
  email: string;
  avatar?: string;
  roles: string[];
  createdAt: string;
}

export interface LoginRequest {
  username: string;
  password: string;
  /** Flag to indicate password is encrypted */
  encrypted?: boolean;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  userInfo: User;
  /** Whether user must change password on first login */
  mustChangePassword?: boolean;
}
