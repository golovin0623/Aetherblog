import { useHotkeys } from 'react-hotkeys-hook';
import { useCallback } from 'react';
import { toast } from 'sonner';

/**
 * 媒体库键盘快捷键配置
 * @ref Phase 6: 性能优化 - 键盘快捷键
 *
 * 快捷键列表:
 * - Ctrl/Cmd + U: 上传文件
 * - Ctrl/Cmd + N: 新建文件夹
 * - Ctrl/Cmd + A: 全选
 * - Delete/Backspace: 删除选中
 * - Ctrl/Cmd + F: 搜索
 * - Escape: 取消选择/关闭对话框
 * - Ctrl/Cmd + /: 显示快捷键帮助
 */

export interface MediaKeyboardShortcutsProps {
  onUpload?: () => void;
  onNewFolder?: () => void;
  onSelectAll?: () => void;
  onDelete?: () => void;
  onSearch?: () => void;
  onEscape?: () => void;
  onToggleHelp?: () => void;
  enabled?: boolean;
}

export function useMediaKeyboardShortcuts({
  onUpload,
  onNewFolder,
  onSelectAll,
  onDelete,
  onSearch,
  onEscape,
  onToggleHelp,
  enabled = true,
}: MediaKeyboardShortcutsProps) {
  // 上传文件 (Ctrl/Cmd + U)
  useHotkeys(
    'ctrl+u, meta+u',
    (e) => {
      e.preventDefault();
      onUpload?.();
      toast.info('打开上传对话框');
    },
    { enabled }
  );

  // 新建文件夹 (Ctrl/Cmd + N)
  useHotkeys(
    'ctrl+n, meta+n',
    (e) => {
      e.preventDefault();
      onNewFolder?.();
      toast.info('创建新文件夹');
    },
    { enabled }
  );

  // 全选 (Ctrl/Cmd + A)
  useHotkeys(
    'ctrl+a, meta+a',
    (e) => {
      e.preventDefault();
      onSelectAll?.();
      toast.info('已全选');
    },
    { enabled }
  );

  // 删除选中 (Delete/Backspace)
  useHotkeys(
    'delete, backspace',
    (e) => {
      // 只在不是输入框时触发
      if ((e.target as HTMLElement).tagName !== 'INPUT' && (e.target as HTMLElement).tagName !== 'TEXTAREA') {
        e.preventDefault();
        onDelete?.();
      }
    },
    { enabled }
  );

  // 搜索 (Ctrl/Cmd + F)
  useHotkeys(
    'ctrl+f, meta+f',
    (e) => {
      e.preventDefault();
      onSearch?.();
      toast.info('打开搜索');
    },
    { enabled }
  );

  // 取消/关闭 (Escape)
  useHotkeys(
    'escape',
    () => {
      onEscape?.();
    },
    { enabled }
  );

  // 显示快捷键帮助 (Ctrl/Cmd + /)
  useHotkeys(
    'ctrl+slash, meta+slash',
    (e) => {
      e.preventDefault();
      onToggleHelp?.();
    },
    { enabled }
  );
}

