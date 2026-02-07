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
        config.headers.set('Authorization', `Bearer ${token}`);
      }
      return config;
    });

    this.client.interceptors.response.use(
      (response) => response.data,
      async (error: AxiosError) => {
        const status = error.response?.status;
        const originalRequest = error.config as RetriableAxiosRequestConfig | undefined;
        const requestUrl = originalRequest?.url || '';

        // 对于认证相关请求，尝试刷新 token
        if (
          (status === 401 || status === 403) &&
          originalRequest &&
          !originalRequest._retry &&
          !this.isAuthRequest(requestUrl)
        ) {
          originalRequest._retry = true;
          try {
            await this.tryRefreshToken();
            return this.client.request(originalRequest);
          } catch (refreshError) {
            logger.warn('[Auth] 刷新令牌失败', refreshError);
          }
        }

        // 只对核心认证 API 的 401/403 触发登出
        // AI 服务、第三方 API 等的错误不触发登出，只抛出错误让页面处理
        if (status === 401 || status === 403) {
          const authStore = useAuthStore.getState();
          
          // AI 相关请求的认证错误不触发登出
          if (this.isAiRequest(requestUrl)) {
            logger.warn(`[AI] AI 服务认证失败 (${status})，请检查 AI 配置。请求路径: ${requestUrl}`);
            return Promise.reject(error.response?.data || error);
          }
          
          // 其他管理 API 的认证错误也不立即登出，只有在刷新失败后才登出
          // 增加 isAiRequest 保护，确保即便没有 _retry 标记也不会误登出
          if (authStore.isAuthenticated && originalRequest?._retry) {
            logger.warn(`[Auth] Token 刷新后仍认证失败 (${status})，正在登出... 请求路径: ${requestUrl}`);
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

  private isAiRequest(url?: string): boolean {
    if (!url) return false;
    // AI 服务相关的所有路径，支持全路径和相对路径检查
    const aiPaths = [
      '/v1/admin/ai/',
      '/v1/admin/providers',
      '/ai-service/',
      'admin/providers',
      'admin/ai/'
    ];
    return aiPaths.some(path => url.includes(path));
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
