/**
 * @file AuthGuard.tsx
 * @description Authentication guard that validates token before rendering protected routes.
 * 
 * This component solves the issue of stale persisted auth state by actively validating
 * the token with the backend on initial render. If the token is invalid or expired,
 * the user is immediately redirected to login without seeing the protected content.
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
  const { isAuthenticated, token, logout, login, user } = useAuthStore();
  const [authStatus, setAuthStatus] = useState<AuthStatus>(
    // If no stored auth, immediately mark as unauthenticated
    isAuthenticated && token ? 'checking' : 'unauthenticated'
  );

  useEffect(() => {
    // If no token or already unauthenticated, skip validation
    if (!token || !isAuthenticated) {
      setAuthStatus('unauthenticated');
      return;
    }

    // Validate token with backend
    const validateToken = async () => {
      try {
        const res = await authService.getCurrentUser();
        
        if (res.code === 200 && res.data) {
          // Token is valid, update user info if needed
          logger.info('[AuthGuard] Token validated successfully');
          setAuthStatus('authenticated');
        } else {
          // Token is invalid
          logger.warn('[AuthGuard] Token validation failed:', res.message);
          logout();
          setAuthStatus('unauthenticated');
        }
      } catch (error) {
        // Network error or 401/403 (interceptor may have already logged out)
        logger.error('[AuthGuard] Token validation error:', error);
        logout();
        setAuthStatus('unauthenticated');
      }
    };

    validateToken();
  }, []); // Only run on mount

  // Show loading spinner while validating
  if (authStatus === 'checking') {
    return (
      <div className="min-h-screen bg-[#09090b] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="absolute inset-0 rounded-full bg-primary/20 blur-xl animate-pulse" />
            <Loader2 className="w-12 h-12 text-primary animate-spin relative z-10" />
          </div>
          <p className="text-gray-400 text-sm animate-pulse">正在验证身份...</p>
        </div>
      </div>
    );
  }

  // Redirect to login if not authenticated
  if (authStatus === 'unauthenticated') {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Token is valid, render children
  return <>{children}</>;
}

export default AuthGuard;
