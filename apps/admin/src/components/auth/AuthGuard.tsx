/**
 * @file AuthGuard.tsx
 * @description 认证守卫，在渲染受保护路由前验证令牌。
 *
 * 此组件通过在初始渲染时主动与后端验证令牌，解决了持久化认证状态过时的问题。
 * 如果令牌无效或过期，用户将立即重定向到登录页面，而不会看到受保护的内容。
 */

import React, { useEffect } from 'react';
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

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    const validateSession = async () => {
      try {
        const res = await authService.getCurrentUser();
        if (res.code !== 200 || !res.data) {
          logout();
        }
      } catch (error) {
        logger.error('[AuthGuard] Session validation error:', error);
        logout();
      }
    };

    validateSession();
  }, [isAuthenticated, logout]);

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}

export default AuthGuard;
