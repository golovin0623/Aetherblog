/**
 * @file AuthGuard.tsx
 * @description 认证守卫，在渲染受保护路由前验证令牌。
 * 
 * 此组件通过在初始渲染时主动与后端验证令牌，解决了持久化认证状态过时的问题。
 * 如果令牌无效或过期，用户将立即重定向到登录页面，而不会看到受保护的内容。
 */

import React, { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuthStore } from '@/stores';
import { authService } from '@/services/authService';
import { logger } from '@/lib/logger';

interface AuthGuardProps {
  children: React.ReactNode;
}

type AuthStatus = 'checking' | 'authenticated' | 'unauthenticated';

export function AuthGuard({ children }: AuthGuardProps) {
  const location = useLocation();
  const { isAuthenticated, token, logout } = useAuthStore();

  // 我们信任持久化的认证状态进行初始渲染，以便立即显示骨架屏。
  // 后台验证将处理过期的令牌。
  const [isChecking, setIsChecking] = useState(isAuthenticated && token);

  useEffect(() => {
    if (!token || !isAuthenticated) {
      return;
    }

    const validateToken = async () => {
      try {
        const res = await authService.getCurrentUser();
        if (res.code !== 200 || !res.data) {
          logout();
        }
      } catch (error) {
        logger.error('[AuthGuard] Token validation error:', error);
        logout();
      } finally {
        setIsChecking(false);
      }
    };

    validateToken();
  }, [token, isAuthenticated, logout]);

  // 如果明确未认证，则重定向
  if (!isAuthenticated || !token) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // 如果我们有令牌，立即渲染子组件以便显示骨架屏。
  // 如果令牌实际上无效，后台检查将踢出用户。
  return <>{children}</>;
}

export default AuthGuard;
