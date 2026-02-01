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
  /** 标记密码是否已加密 */
  encrypted?: boolean;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  userInfo: User;
  /** 用户是否必须在首次登录时更改密码 */
  mustChangePassword?: boolean;
}
