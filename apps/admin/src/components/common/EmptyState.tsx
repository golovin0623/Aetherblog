import { FileX, Search, Inbox } from 'lucide-react';

interface EmptyStateProps {
  type?: 'no-data' | 'no-results' | 'error';
  title?: string;
  message?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function EmptyState({ type = 'no-data', title, message, action }: EmptyStateProps) {
  const icons = {
    'no-data': Inbox,
    'no-results': Search,
    'error': FileX,
  };

  const defaultMessages = {
    'no-data': { title: '暂无数据', message: '还没有任何内容' },
    'no-results': { title: '未找到结果', message: '尝试调整搜索条件' },
    'error': { title: '加载失败', message: '请稍后重试' },
  };

  const Icon = icons[type];
  const displayTitle = title || defaultMessages[type].title;
  const displayMessage = message || defaultMessages[type].message;

  return (
    <div className="flex flex-col items-center justify-center py-12">
      <div className="w-16 h-16 rounded-full bg-[var(--bg-secondary)] flex items-center justify-center mb-4">
        <Icon className="w-8 h-8 text-[var(--text-muted)]" />
      </div>
      <h3 className="text-lg font-medium text-[var(--text-primary)]">{displayTitle}</h3>
      <p className="text-[var(--text-secondary)] mt-1">{displayMessage}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="mt-4 px-4 py-2 rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

export default EmptyState;
