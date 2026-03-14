import { useQuery } from '@tanstack/react-query';
import { settingsService } from '@/services/settingsService';
import { getMediaUrl } from '@/services/mediaService';

/**
 * 获取站点 Logo URL
 * 返回已解析的完整 URL，若未配置则返回空字符串
 */
export function useSiteLogo(): string {
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => settingsService.getAll(),
    staleTime: 5 * 60 * 1000, // 5分钟缓存
  });

  const raw = settings?.site_logo as string | undefined;
  if (!raw) return '';
  return getMediaUrl(raw);
}
