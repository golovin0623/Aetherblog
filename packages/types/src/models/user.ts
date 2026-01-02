/**
 * 用户类型
 */

export type UserRole = 'ADMIN' | 'AUTHOR' | 'READER';

export interface User {
  id: number;
  username: string;
  nickname: string;
  email: string;
  avatar?: string;
  bio?: string;
  roles: UserRole[];
  createdAt: string;
  updatedAt: string;
}

export interface LoginInput {
  username: string;
  password: string;
  rememberMe?: boolean;
}

export interface LoginResult {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  user: User;
}

export interface RegisterInput {
  username: string;
  email: string;
  password: string;
  nickname?: string;
}
