/**
 * API Configuration
 * 
 * 服务端渲染 (SSR): 使用 API_URL (Docker 内部网络 http://backend:8080)
 * 客户端浏览器: 使用相对路径 /api (通过 nginx 网关代理)
 */

// 检测是否在服务端运行
const isServer = typeof window === 'undefined';

// 服务端使用 Docker 内部网络地址，客户端使用相对路径
const API_BASE_URL = isServer 
  ? (process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080')
  : '';  // 客户端使用空字符串，让请求变成相对路径

export const API_ENDPOINTS = {
  // Public Posts
  posts: `${API_BASE_URL}/api/v1/public/posts`,
  postBySlug: (slug: string) => `${API_BASE_URL}/api/v1/public/posts/${slug}`,
  
  // Friend Links
  friendLinks: `${API_BASE_URL}/api/v1/public/friend-links`,
  
  // Archives
  archives: `${API_BASE_URL}/api/v1/public/archives`,

  // Site Settings
  settings: `${API_BASE_URL}/api/v1/public/site/info`,

  // Comments
  comments: (postId: number) => `${API_BASE_URL}/api/v1/public/comments/post/${postId}`,
};

// 提供两个版本的 URL，供需要明确指定的场景使用
export const SERVER_API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
export const CLIENT_API_URL = '';  // 相对路径

export default API_BASE_URL;
