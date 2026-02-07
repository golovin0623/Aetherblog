import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from 'axios';
import { useAuthStore } from '@/stores';
import { logger } from '@/lib/logger';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

interface RetriableAxiosRequestConfig extends AxiosRequestConfig {
  _retry?: boolean;
}

class ApiClient {
  private client: AxiosInstance;
  private refreshPromise: Promise<void> | null = null;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      timeout: 120000,
      withCredentials: true,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.client.interceptors.request.use((config) => {
      const token = useAuthStore.getState().token;
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });

    this.client.interceptors.response.use(
      (response) => response.data,
      async (error: AxiosError) => {
        const status = error.response?.status;
        const originalRequest = error.config as RetriableAxiosRequestConfig | undefined;

        if (
          (status === 401 || status === 403) &&
          originalRequest &&
          !originalRequest._retry &&
          !this.isAuthRequest(originalRequest.url)
        ) {
          originalRequest._retry = true;
          try {
            await this.tryRefreshToken();
            return this.client.request(originalRequest);
          } catch (refreshError) {
            logger.warn('[Auth] 刷新令牌失败，准备登出', refreshError);
          }
        }

        if (status === 401 || status === 403) {
          const authStore = useAuthStore.getState();
          if (authStore.isAuthenticated) {
            logger.warn(`[Auth] 认证失败 (${status})，正在登出...`);
            authStore.logout();
            const loginPath = import.meta.env.BASE_URL === '/' ? '/login' : `${import.meta.env.BASE_URL}login`;
            window.location.replace(loginPath);
          }
        }

        return Promise.reject(error.response?.data || error);
      }
    );
  }

  private isAuthRequest(url?: string): boolean {
    if (!url) return false;
    return url.includes('/v1/auth/login') || url.includes('/v1/auth/refresh') || url.includes('/v1/auth/logout');
  }

  private async tryRefreshToken(): Promise<void> {
    if (!this.refreshPromise) {
      this.refreshPromise = this.post<{ code: number; message?: string }>('/v1/auth/refresh')
        .then((res) => {
          if (!res || res.code !== 200) {
            throw new Error(res?.message || 'Refresh token failed');
          }
        })
        .finally(() => {
          this.refreshPromise = null;
        });
    }

    return this.refreshPromise;
  }

  async get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    return this.client.get(url, config);
  }

  async post<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    return this.client.post(url, data, config);
  }

  async put<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    return this.client.put(url, data, config);
  }

  async patch<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    return this.client.patch(url, data, config);
  }

  async delete<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    return this.client.delete(url, config);
  }
}

export const apiClient = new ApiClient();
export default apiClient;
