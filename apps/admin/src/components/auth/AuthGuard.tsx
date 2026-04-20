/**
 * @file AuthGuard.tsx
 * @description 认证守卫，在渲染受保护路由前验证令牌。
 *
 * 此组件通过在初始渲染时主动与后端验证令牌，解决了持久化认证状态过时的问题。
 * 如果令牌无效或过期，用户将立即重定向到登录页面，而不会看到受保护的内容。
 */

import React, { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores';
import { authService } from '@/services/authService';
import { logger } from '@/lib/logger';

interface AuthGuardProps {
  children: React.ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
  const location = useLocation();
  const { isAuthenticated, logout } = useAuthStore();
  const [isValidating, setIsValidating] = useState(true);

  useEffect(() => {
    if (!isAuthenticated) {
      setIsValidating(false);
      return;
    }

    const validateSession = async () => {
      try {
        const res = await authService.getCurrentUser();
        if (res.code !== 200 || !res.data) {
          logout();
        } else {
          // 会话验证通过后同步最新的用户档案（昵称、头像、邮箱等）——
          // 过去只校验 code 不写 store,导致用户改了昵称或上传了头像后,
          // 侧边栏 / 个人面板仍然显示旧值甚至空值。
          // 注意：/auth/me 返回 roles[] (UserInfoVO),authStore 用 role 单数,
          // 与 LoginPage 适配逻辑保持一致。
          const info = res.data;
          const roleStr = (info.roles && info.roles.length > 0) ? info.roles[0] : 'USER';
          const validRoles = ['ADMIN', 'EDITOR', 'USER'] as const;
          const role = validRoles.includes(roleStr as typeof validRoles[number])
            ? (roleStr as 'ADMIN' | 'EDITOR' | 'USER')
            : 'USER';
          useAuthStore.setState({
            user: {
              id: String(info.id),
              username: info.username,
              nickname: info.nickname,
              avatar: info.avatar || '',
              email: info.email,
              role,
            },
          });
        }
      } catch (error) {
        logger.error('[AuthGuard] Session validation error:', error);
        logout();
      } finally {
        setIsValidating(false);
      }
    };

    validateSession();
  }, [isAuthenticated, logout]);

  if (isValidating) {
    return null;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}

export default AuthGuard;
