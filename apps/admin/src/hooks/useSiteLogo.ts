import { useSiteBranding } from './useSiteBranding';

/**
 * 获取站点 Logo URL
 * 返回已解析的完整 URL，若未配置则返回空字符串
 */
export function useSiteLogo(): string {
  return useSiteBranding().siteLogo;
}
