/**
 * API Configuration
 * 
 * Uses environment variables for API base URL with fallback for development
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

export const API_ENDPOINTS = {
  // Public Posts
  posts: `${API_BASE_URL}/api/v1/public/posts`,
  postBySlug: (slug: string) => `${API_BASE_URL}/api/v1/public/posts/${slug}`,
  
  // Friend Links
  friendLinks: `${API_BASE_URL}/v1/friend-links`,
  
  // Archives
  archives: `${API_BASE_URL}/api/v1/public/archives`,
};

export default API_BASE_URL;
