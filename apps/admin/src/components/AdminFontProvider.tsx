import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { settingsService } from '@/services/settingsService';
import { FontPreviewProvider } from '@/contexts/FontPreviewContext';
import { getFontOption } from '@/components/settings/FontPickerModal';
import { toast } from 'sonner';

/**
 * AdminFontProvider - 管理后台全局字体应用
 * 从后端获取 font_family 设置，通过 FontPreviewProvider 管理字体和预览
 */
export default function AdminFontProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();

  const { data: fontId = 'system' } = useQuery({
    queryKey: ['settings'],
    queryFn: () => settingsService.getAll(),
    select: (all) => (all.font_family as string) || 'system',
    staleTime: 60 * 1000,
  });

  const handleSaveFontId = useCallback((newFontId: string) => {
    settingsService.batchUpdate({ font_family: newFontId }).then(() => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast.success(`已应用「${getFontOption(newFontId)?.name}」字体`);
    }).catch(() => {
      toast.error('字体保存失败');
    });
  }, [queryClient]);

  return (
    <FontPreviewProvider
      savedFontId={fontId}
      onSaveFontId={handleSaveFontId}
    >
      {children}
    </FontPreviewProvider>
  );
}
