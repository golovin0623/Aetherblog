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
  const { isAuthenticated, token, logout } = useAuthStore();

  // We trust the persisted auth state for the initial render to show skeletons immediately.
  // The background validation will handle expired tokens.
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

  // If definitely not authenticated, redirect
  if (!isAuthenticated || !token) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // If we have a token, we render children immediately so skeletons can show.
  // The background check will kick the user out if the token is actually invalid.
  return <>{children}</>;
}

export default AuthGuard;
