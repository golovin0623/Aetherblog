import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  FileText,
  MessageSquare,
  User,
  Settings,
  Link,
  Image,
  Sparkles,
  AlertTriangle,
  Clock,
  ArrowUpRight
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { activityService, ActivityEvent } from '@/services/activityService';

/**
 * 事件类别配置
 * 定义每种事件类别的图标、颜色等视觉属性
 */
const categoryConfig = {
  post: {
    icon: FileText,
    bgColor: 'bg-status-info-light',
    borderColor: 'border-status-info-border',
    textColor: 'text-status-info',
  },
  comment: {
    icon: MessageSquare,
    bgColor: 'bg-status-success-light',
    borderColor: 'border-status-success-border',
    textColor: 'text-status-success',
  },
  user: {
    icon: User,
    bgColor: 'bg-accent/10',
    borderColor: 'border-accent/20',
    textColor: 'text-accent',
  },
  system: {
    icon: Settings,
    bgColor: 'bg-[var(--bg-tertiary)]',
    borderColor: 'border-[var(--border-default)]',
    textColor: 'text-[var(--text-muted)]',
  },
  friend: {
    icon: Link,
    bgColor: 'bg-pink-500/10',
    borderColor: 'border-pink-500/20',
    textColor: 'text-pink-500',
  },
  media: {
    icon: Image,
    bgColor: 'bg-cyan-500/10',
    borderColor: 'border-cyan-500/20',
    textColor: 'text-cyan-500',
  },
  ai: {
    icon: Sparkles,
    bgColor: 'bg-primary/10',
    borderColor: 'border-primary/20',
    textColor: 'text-primary',
  },
};

/**
 * 状态颜色配置
 */
const statusColors = {
  INFO: 'text-[var(--text-muted)]',
  SUCCESS: 'text-status-success',
  WARNING: 'text-status-warning',
  ERROR: 'text-status-danger',
};

interface RecentActivityProps {
  loading?: boolean;
}

/**
 * 最近动态组件
 * 展示系统中的最近活动事件
 * 
 * @ref §8.2 - 仪表盘最近动态
 */
export function RecentActivity({ loading: externalLoading }: RecentActivityProps) {
  const navigate = useNavigate();

  // 从 API 获取最近动态
  const { data: activities, isLoading } = useQuery({
    queryKey: ['activities', 'recent'],
    queryFn: async () => {
      const res = await activityService.getRecentActivities(10);
      return res.code === 200 ? res.data : [];
    },
    refetchInterval: 60000, // 每分钟刷新
  });

  const loading = externalLoading || isLoading;

  const getIcon = (category: ActivityEvent['eventCategory'], status: string) => {
    // 警告和错误状态使用警告图标
    if (status === 'WARNING' || status === 'ERROR') {
      return <AlertTriangle className={cn('w-4 h-4', statusColors[status as keyof typeof statusColors])} />;
    }
    
    const config = categoryConfig[category] || categoryConfig.system;
    const Icon = config.icon;
    return <Icon className={cn('w-4 h-4', config.textColor)} />;
  };

  const getColors = (category: ActivityEvent['eventCategory'], status: string) => {
    // 警告和错误状态使用特殊颜色
    if (status === 'WARNING') {
      return { bgColor: 'bg-status-warning-light', borderColor: 'border-status-warning-border' };
    }
    if (status === 'ERROR') {
      return { bgColor: 'bg-status-danger-light', borderColor: 'border-status-danger-border' };
    }
    
    return categoryConfig[category] || categoryConfig.system;
  };

  const handleViewAll = () => {
    navigate('/activities');
  };

  if (loading) {
    return (
      <div className="p-6 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] h-[420px]">
        <div className="flex justify-between items-center mb-4">
          <div className="w-24 h-6 bg-[var(--bg-secondary)] rounded animate-pulse" />
          <div className="w-16 h-4 bg-[var(--bg-secondary)] rounded animate-pulse" />
        </div>
        <div className="space-y-4 ml-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="flex items-start gap-4 relative overflow-hidden">
              <div className="w-6 h-6 bg-[var(--bg-secondary)] rounded-full flex-shrink-0 animate-pulse" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-[var(--bg-secondary)] rounded w-3/4 animate-pulse relative overflow-hidden">
                  <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/5 to-transparent" />
                </div>
                <div className="h-3 bg-[var(--bg-secondary)] rounded w-1/2 animate-pulse relative overflow-hidden">
                  <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/5 to-transparent" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // 没有数据时显示空状态
  if (!activities || activities.length === 0) {
    return (
      <div className="p-6 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] h-full flex flex-col">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">最近动态</h3>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-[var(--text-muted)]">
            <Clock className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p className="text-sm">暂无活动记录</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] h-full flex flex-col">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">最近动态</h3>
        <button 
          onClick={handleViewAll}
          className="text-[var(--text-muted)] hover:text-primary transition-colors"
          title="查看全部"
        >
          <ArrowUpRight className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-hidden">
        <div className="space-y-6 relative h-full overflow-y-auto pr-2 pl-10 pt-2">
          {/* Vertical Line */}
          <div className="absolute left-[20px] top-2 bottom-2 w-px bg-[var(--border-subtle)]" />

          {activities.map((item) => {
            const colors = getColors(item.eventCategory, item.status);
            
            return (
              <div key={item.id} className="relative">
                {/* Timeline Dot */}
                <div className={cn(
                  "absolute left-[-32px] top-1 w-6 h-6 rounded-full border flex items-center justify-center bg-[var(--bg-card)] backdrop-blur-sm z-10",
                  colors.bgColor,
                  colors.borderColor
                )}>
                  {getIcon(item.eventCategory, item.status)}
                </div>

                <div className="space-y-1 pl-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-[var(--text-primary)]">{item.title}</p>
                    <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] flex-shrink-0">
                      <Clock className="w-3 h-3" />
                      <span>
                        {formatDistanceToNow(new Date(item.createdAt), {
                          addSuffix: true,
                          locale: zhCN
                        })}
                      </span>
                    </div>
                  </div>

                  {item.description && (
                    <p className="text-xs text-[var(--text-secondary)] line-clamp-2">
                      {item.description}
                    </p>
                  )}

                  {item.user && (
                    <p className="text-xs text-[var(--text-muted)] mt-1">
                      by <span className="text-[var(--text-primary)]">{item.user.nickname || item.user.username}</span>
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default RecentActivity;
