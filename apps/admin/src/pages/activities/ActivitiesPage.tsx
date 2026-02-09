import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
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
  Filter,
  RefreshCw,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { activityService, ActivityEvent, ActivityQueryParams } from '@/services/activityService';

/**
 * 事件类别配置
 */
const categoryConfig = {
  post: { icon: FileText, label: '文章', bgColor: 'bg-blue-500/10', borderColor: 'border-blue-500/20', textColor: 'text-blue-400' },
  comment: { icon: MessageSquare, label: '评论', bgColor: 'bg-green-500/10', borderColor: 'border-green-500/20', textColor: 'text-green-400' },
  user: { icon: User, label: '用户', bgColor: 'bg-purple-500/10', borderColor: 'border-purple-500/20', textColor: 'text-purple-400' },
  system: { icon: Settings, label: '系统', bgColor: 'bg-gray-500/10', borderColor: 'border-gray-500/20', textColor: 'text-gray-400' },
  friend: { icon: Link, label: '友链', bgColor: 'bg-pink-500/10', borderColor: 'border-pink-500/20', textColor: 'text-pink-400' },
  media: { icon: Image, label: '媒体', bgColor: 'bg-cyan-500/10', borderColor: 'border-cyan-500/20', textColor: 'text-cyan-400' },
  ai: { icon: Sparkles, label: 'AI', bgColor: 'bg-indigo-500/10', borderColor: 'border-indigo-500/20', textColor: 'text-indigo-400' },
};

const statusConfig = {
  INFO: { label: '信息', color: 'text-gray-400', bgColor: 'bg-gray-500/10' },
  SUCCESS: { label: '成功', color: 'text-green-400', bgColor: 'bg-green-500/10' },
  WARNING: { label: '警告', color: 'text-orange-400', bgColor: 'bg-orange-500/10' },
  ERROR: { label: '错误', color: 'text-red-400', bgColor: 'bg-red-500/10' },
};

const categories = ['all', 'post', 'comment', 'user', 'system', 'friend', 'media', 'ai'] as const;

/**
 * 活动事件列表页面
 * 
 * @ref §8.2 - 活动事件管理
 */
export default function ActivitiesPage() {
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [pageNum, setPageNum] = useState(1);
  const pageSize = 20;

  const queryParams: ActivityQueryParams = {
    category: selectedCategory === 'all' ? undefined : selectedCategory,
    pageNum,
    pageSize,
  };

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['activities', queryParams],
    queryFn: async () => {
      const res = await activityService.getActivities(queryParams);
      return res.code === 200 ? res.data : { list: [], total: 0 };
    },
  });

  const activities = data?.list || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / pageSize);

  const getIcon = (category: ActivityEvent['eventCategory'], status: string) => {
    if (status === 'WARNING' || status === 'ERROR') {
      return <AlertTriangle className={cn('w-5 h-5', status === 'WARNING' ? 'text-orange-400' : 'text-red-400')} />;
    }
    const config = categoryConfig[category] || categoryConfig.system;
    const Icon = config.icon;
    return <Icon className={cn('w-5 h-5', config.textColor)} />;
  };

  const getColors = (category: ActivityEvent['eventCategory'], status: string) => {
    if (status === 'WARNING') return { bgColor: 'bg-orange-500/10', borderColor: 'border-orange-500/20' };
    if (status === 'ERROR') return { bgColor: 'bg-red-500/10', borderColor: 'border-red-500/20' };
    return categoryConfig[category] || categoryConfig.system;
  };

  return (
    <div className="p-6 space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">活动记录</h1>
          <p className="text-[var(--text-secondary)] mt-1">查看系统中的所有活动事件</p>
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          刷新
        </button>
      </div>

      {/* 筛选器 */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 text-[var(--text-muted)]">
          <Filter className="w-4 h-4" />
          <span className="text-sm">筛选:</span>
        </div>
        {categories.map((cat) => {
          const config = cat === 'all' ? null : categoryConfig[cat as keyof typeof categoryConfig];
          const isSelected = selectedCategory === cat;
          
          return (
            <button
              key={cat}
              onClick={() => { setSelectedCategory(cat); setPageNum(1); }}
              className={cn(
                'px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
                isSelected
                  ? 'bg-primary text-white'
                  : 'bg-[var(--bg-card)] text-[var(--text-secondary)] border border-[var(--border-subtle)] hover:bg-[var(--bg-card-hover)]'
              )}
            >
              {cat === 'all' ? '全部' : config?.label}
            </button>
          );
        })}
      </div>

      {/* 活动列表 */}
      <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border-subtle)] overflow-hidden">
        {isLoading ? (
          <div className="p-8 space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex items-start gap-4 animate-pulse">
                <div className="w-10 h-10 rounded-full bg-[var(--bg-secondary)]" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-3/4 bg-[var(--bg-secondary)] rounded" />
                  <div className="h-3 w-1/2 bg-[var(--bg-secondary)] rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : activities.length === 0 ? (
          <div className="py-16 text-center">
            <Clock className="w-16 h-16 mx-auto text-[var(--text-muted)] opacity-50 mb-4" />
            <p className="text-[var(--text-secondary)]">暂无活动记录</p>
          </div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div
              key={`${selectedCategory}-${pageNum}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="divide-y divide-[var(--border-subtle)]"
            >
              {activities.map((item, index) => {
                const colors = getColors(item.eventCategory, item.status);
                const statusCfg = statusConfig[item.status];

                return (
                  <motion.div
                    key={item.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.03 }}
                    className="p-4 hover:bg-[var(--bg-card-hover)] transition-colors"
                  >
                    <div className="flex items-start gap-4">
                      {/* 图标 */}
                      <div className={cn(
                        'w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0',
                        colors.bgColor,
                        'border',
                        colors.borderColor
                      )}>
                        {getIcon(item.eventCategory, item.status)}
                      </div>

                      {/* 内容 */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <p className="text-[var(--text-primary)] font-medium">{item.title}</p>
                            {item.description && (
                              <p className="text-sm text-[var(--text-secondary)] mt-1 line-clamp-2">
                                {item.description}
                              </p>
                            )}
                            <div className="flex items-center gap-3 mt-2 text-xs text-[var(--text-muted)]">
                              {item.user && (
                                <span>
                                  操作者: <span className="text-[var(--text-secondary)]">{item.user.nickname || item.user.username}</span>
                                </span>
                              )}
                              {item.ip && (
                                <span>IP: {item.ip}</span>
                              )}
                              <span className={cn('px-1.5 py-0.5 rounded text-xs', statusCfg.bgColor, statusCfg.color)}>
                                {statusCfg.label}
                              </span>
                            </div>
                          </div>
                          
                          {/* 时间 */}
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
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </motion.div>
          </AnimatePresence>
        )}
      </div>

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-[var(--text-muted)]">
            共 {total} 条记录，第 {pageNum}/{totalPages} 页
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPageNum(p => Math.max(1, p - 1))}
              disabled={pageNum <= 1}
              className="p-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-3 py-1 text-sm text-[var(--text-secondary)]">
              {pageNum}
            </span>
            <button
              onClick={() => setPageNum(p => Math.min(totalPages, p + 1))}
              disabled={pageNum >= totalPages}
              className="p-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
