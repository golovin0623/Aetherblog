import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { useAuthStore } from '@/stores';
import { logger } from '@/lib/logger';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

class ApiClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      timeout: 120000, // AI 操作超时时间 2 分钟
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // 请求拦截器 - 添加 Token
    this.client.interceptors.request.use((config) => {
      const token = useAuthStore.getState().token;
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });

    // 响应拦截器 - 处理错误
    this.client.interceptors.response.use(
      (response) => response.data,
      (error) => {
        const status = error.response?.status;
        
        // 处理认证失败 (401 Unauthorized 或 403 Forbidden)
        // Token 过期、无效或权限不足时自动登出
        if (status === 401 || status === 403) {
          const authStore = useAuthStore.getState();
          
          // 只有当前已登录状态时才执行登出，避免重复跳转
          if (authStore.isAuthenticated) {
            logger.warn(`[Auth] 认证失败 (${status})，正在登出...`);
            authStore.logout();
            
            // 使用 replace 避免后退时回到已失效的页面
            // 注意：因为应用部署在 /admin/ 下，所以必须跳转到 /admin/login
            const loginPath = import.meta.env.BASE_URL === '/' ? '/login' : `${import.meta.env.BASE_URL}login`;
            window.location.replace(loginPath);
          }
        }
        
        return Promise.reject(error.response?.data || error);
      }
    );
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
