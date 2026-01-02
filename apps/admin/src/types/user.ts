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
}

export interface LoginResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  user: User;
}
