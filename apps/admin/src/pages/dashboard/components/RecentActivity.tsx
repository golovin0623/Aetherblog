import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Clock,
  ArrowUpRight
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { activityService } from '@/services/activityService';
import { activityToneStyle, getActivityVisual } from '@/lib/activityVisuals';

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
    queryKey: ['activities', 'recent', 8],
    queryFn: async () => {
      const res = await activityService.getRecentActivities(8);
      return res.code === 200 ? res.data : [];
    },
    refetchInterval: 60000, // 每分钟刷新
  });

  const loading = externalLoading || isLoading;
  const visibleActivities = (activities || []).slice(0, 8);

  const handleViewAll = () => {
    navigate('/activities?from=dashboard');
  };

  if (loading) {
    return (
      <div className="surface-leaf surface-dashboard-card p-6 rounded-xl h-[420px]">
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
                  <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-[var(--bg-card-hover)] to-transparent" />
                </div>
                <div className="h-3 bg-[var(--bg-secondary)] rounded w-1/2 animate-pulse relative overflow-hidden">
                  <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-[var(--bg-card-hover)] to-transparent" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // 没有数据时显示空状态
  if (visibleActivities.length === 0) {
    return (
      <div className="surface-leaf surface-dashboard-card p-6 rounded-xl h-full flex flex-col">
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
    <div className="surface-leaf surface-dashboard-card p-6 rounded-xl h-full flex flex-col">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">最近动态</h3>
        <button 
          onClick={handleViewAll}
          className="text-[var(--text-muted)] hover:text-[var(--dashboard-aurora-1)] transition-colors"
          title="查看全部"
        >
          <ArrowUpRight className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-hidden">
        <div className="relative h-full overflow-y-auto pr-2 pl-10">
          {visibleActivities.map((item, index) => {
            const visual = getActivityVisual(item.eventCategory, item.status);
            const Icon = visual.icon;
            const isLast = index === visibleActivities.length - 1;
            
            return (
              <div key={item.id} className="relative pb-5 last:pb-0">
                {!isLast && (
                  <div className="absolute left-[-21px] top-3.5 bottom-[-1.25rem] w-px bg-[var(--border-subtle)]" />
                )}

                {/* 时间轴节点 */}
                <div
                  className="absolute left-[-34px] top-0 z-10 flex h-7 w-7 items-center justify-center rounded-xl border bg-[color-mix(in_oklch,var(--activity-tone)_12%,transparent)] text-[var(--activity-tone)] shadow-[inset_0_1px_0_color-mix(in_oklch,var(--activity-tone)_18%,transparent)] border-[color-mix(in_oklch,var(--activity-tone)_30%,transparent)] backdrop-blur-sm"
                  style={activityToneStyle(visual.tone)}
                  data-activity-icon
                  data-category={item.eventCategory}
                  data-status={item.status}
                >
                  <Icon className="w-3.5 h-3.5" />
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
