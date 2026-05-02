import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FileText,
  MessageSquare,
  User,
  Settings,
  Link,
  Image,
  Sparkles,
  Shield,
  AlertTriangle,
  Clock,
  Filter,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  Search as SearchIcon,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDebounce } from '@aetherblog/hooks';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { activityService, ActivityEvent, ActivityQueryParams } from '@/services/activityService';

/**
 * 事件类别配置
 */
const categoryConfig = {
  post: { icon: FileText, label: '文章', bgColor: 'bg-status-info-light', borderColor: 'border-status-info-border', textColor: 'text-status-info' },
  comment: { icon: MessageSquare, label: '评论', bgColor: 'bg-status-success-light', borderColor: 'border-status-success-border', textColor: 'text-status-success' },
  user: { icon: User, label: '用户', bgColor: 'bg-accent/10', borderColor: 'border-accent/20', textColor: 'text-accent' },
  system: { icon: Settings, label: '系统', bgColor: 'bg-[var(--bg-tertiary)]', borderColor: 'border-[var(--border-default)]', textColor: 'text-[var(--text-muted)]' },
  friend: { icon: Link, label: '友链', bgColor: 'bg-pink-500/10', borderColor: 'border-pink-500/20', textColor: 'text-pink-400' },
  media: { icon: Image, label: '媒体', bgColor: 'bg-cyan-500/10', borderColor: 'border-cyan-500/20', textColor: 'text-cyan-400' },
  ai: { icon: Sparkles, label: 'AI', bgColor: 'bg-primary/10', borderColor: 'border-primary/20', textColor: 'text-primary' },
  security: { icon: Shield, label: '安全', bgColor: 'bg-status-warning-light', borderColor: 'border-status-warning-border', textColor: 'text-status-warning' },
} as const;

type CategoryKey = keyof typeof categoryConfig;

const statusConfig = {
  INFO: { label: '信息', color: 'text-[var(--text-muted)]', bgColor: 'bg-[var(--bg-tertiary)]' },
  SUCCESS: { label: '成功', color: 'text-status-success', bgColor: 'bg-status-success-light' },
  WARNING: { label: '警告', color: 'text-status-warning', bgColor: 'bg-status-warning-light' },
  ERROR: { label: '错误', color: 'text-status-danger', bgColor: 'bg-status-danger-light' },
} as const;

type StatusKey = keyof typeof statusConfig;

const categories: Array<'all' | CategoryKey> = [
  'all', 'post', 'comment', 'user', 'system', 'friend', 'media', 'ai', 'security',
];

const statuses: Array<'all' | StatusKey> = ['all', 'INFO', 'SUCCESS', 'WARNING', 'ERROR'];

/**
 * 各分类下的细分事件类型 —— 用于 category 选中后的二级 eventType 下拉。
 * 取值与后端 handler 中实际写入的 EventType 严格一致；
 * 新增事件类型时请同步追加，避免下拉框选中后查不到记录。
 */
const eventTypeOptions: Record<CategoryKey, Array<{ value: string; label: string }>> = {
  post: [
    { value: 'post.create', label: '创建文章' },
    { value: 'post.update', label: '更新文章' },
    { value: 'post.delete', label: '删除文章' },
    { value: 'post.publish', label: '发布文章' },
  ],
  comment: [
    { value: 'comment.approve', label: '审核通过' },
    { value: 'comment.delete', label: '删除评论' },
  ],
  user: [
    { value: 'user.login', label: '用户登录' },
  ],
  system: [
    { value: 'system.setting_update', label: '更新设置' },
  ],
  friend: [
    { value: 'friend.create', label: '创建友链' },
    { value: 'friend.delete', label: '删除友链' },
  ],
  media: [
    { value: 'media.upload', label: '上传媒体' },
    { value: 'media.delete', label: '删除媒体' },
  ],
  ai: [],
  security: [
    { value: 'security.jwt_rotate', label: '轮换 JWT 密钥' },
  ],
};

/**
 * 活动事件列表页面
 *
 * @ref §8.2 - 活动事件管理
 */
export default function ActivitiesPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const fromDashboard = searchParams.get('from') === 'dashboard';

  const [selectedCategory, setSelectedCategory] = useState<'all' | CategoryKey>('all');
  const [selectedStatus, setSelectedStatus] = useState<'all' | StatusKey>('all');
  const [selectedEventType, setSelectedEventType] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [startTime, setStartTime] = useState<string>('');
  const [endTime, setEndTime] = useState<string>('');
  const [pageNum, setPageNum] = useState(1);
  const pageSize = 20;

  const debouncedSearch = useDebounce(searchTerm.trim(), 350);

  // 切换分类时重置二级 eventType（避免 post 选中 'post.create' 后切到 comment 仍带着 stale 值）
  useEffect(() => {
    setSelectedEventType('');
  }, [selectedCategory]);

  // 任何过滤维度变化都回到第一页
  useEffect(() => {
    setPageNum(1);
  }, [selectedCategory, selectedStatus, selectedEventType, debouncedSearch, startTime, endTime]);

  const queryParams: ActivityQueryParams = useMemo(() => ({
    category: selectedCategory === 'all' ? undefined : selectedCategory,
    eventType: selectedEventType || undefined,
    status: selectedStatus === 'all' ? undefined : selectedStatus,
    search: debouncedSearch || undefined,
    startTime: startTime || undefined,
    endTime: endTime || undefined,
    pageNum,
    pageSize,
  }), [selectedCategory, selectedStatus, selectedEventType, debouncedSearch, startTime, endTime, pageNum]);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['activities', queryParams],
    queryFn: async () => {
      const res = await activityService.getActivities(queryParams);
      return res.code === 200 ? res.data : { list: [], total: 0 };
    },
  });

  const activities = data?.list || [];
  const total = data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const activeFilterCount = [
    selectedCategory !== 'all',
    selectedStatus !== 'all',
    !!selectedEventType,
    !!debouncedSearch,
    !!startTime,
    !!endTime,
  ].filter(Boolean).length;

  const resetFilters = () => {
    setSelectedCategory('all');
    setSelectedStatus('all');
    setSelectedEventType('');
    setSearchTerm('');
    setStartTime('');
    setEndTime('');
  };

  const lookupCategory = (category: string): typeof categoryConfig.system => {
    const map = categoryConfig as unknown as Record<string, typeof categoryConfig.system>;
    return map[category] ?? categoryConfig.system;
  };

  const getIcon = (category: ActivityEvent['eventCategory'], status: string) => {
    if (status === 'WARNING' || status === 'ERROR') {
      return <AlertTriangle className={cn('w-5 h-5', status === 'WARNING' ? 'text-status-warning' : 'text-status-danger')} />;
    }
    const config = lookupCategory(category);
    const Icon = config.icon;
    return <Icon className={cn('w-5 h-5', config.textColor)} />;
  };

  const getColors = (category: ActivityEvent['eventCategory'], status: string) => {
    if (status === 'WARNING') return { bgColor: 'bg-status-warning-light', borderColor: 'border-status-warning-border' };
    if (status === 'ERROR') return { bgColor: 'bg-status-danger-light', borderColor: 'border-status-danger-border' };
    return lookupCategory(category);
  };

  const subTypeOptions = selectedCategory === 'all' ? [] : eventTypeOptions[selectedCategory];

  return (
    <div className="p-6 space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {fromDashboard && (
            <button
              onClick={() => navigate('/dashboard')}
              className="flex items-center justify-center w-9 h-9 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] transition-colors"
              title="返回仪表盘"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <div>
            <h1 className="text-2xl font-bold text-[var(--text-primary)]">活动记录</h1>
            <p className="text-[var(--text-secondary)] mt-1">查看系统中的所有活动事件</p>
          </div>
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] transition-colors"
        >
          <RefreshCw className={cn('w-4 h-4', isFetching && 'animate-spin')} />
          刷新
        </button>
      </div>

      {/* 筛选区域 */}
      <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border-subtle)] p-4 space-y-4">
        {/* 分类筛选 */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 text-[var(--text-muted)] min-w-[64px]">
            <Filter className="w-4 h-4" />
            <span className="text-sm">分类:</span>
          </div>
          {categories.map((cat) => {
            const config = cat === 'all' ? null : categoryConfig[cat];
            const isSelected = selectedCategory === cat;
            return (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
                  isSelected
                    ? 'bg-primary text-white'
                    : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] border border-[var(--border-subtle)] hover:bg-[var(--bg-card-hover)]'
                )}
              >
                {cat === 'all' ? '全部' : config?.label}
              </button>
            );
          })}
        </div>

        {/* 状态筛选 */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 text-[var(--text-muted)] min-w-[64px]">
            <span className="text-sm">状态:</span>
          </div>
          {statuses.map((s) => {
            const isSelected = selectedStatus === s;
            const cfg = s === 'all' ? null : statusConfig[s];
            return (
              <button
                key={s}
                onClick={() => setSelectedStatus(s)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
                  isSelected
                    ? 'bg-primary text-white'
                    : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] border border-[var(--border-subtle)] hover:bg-[var(--bg-card-hover)]'
                )}
              >
                {s === 'all' ? '全部' : cfg?.label}
              </button>
            );
          })}
        </div>

        {/* 高级筛选行：事件类型下拉 + 时间区间 + 搜索 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* 二级事件类型 */}
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">事件类型</label>
            <select
              value={selectedEventType}
              onChange={(e) => setSelectedEventType(e.target.value)}
              disabled={selectedCategory === 'all' || subTypeOptions.length === 0}
              className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value="">
                {selectedCategory === 'all'
                  ? '先选择分类'
                  : subTypeOptions.length === 0
                    ? '该分类暂无细分'
                    : '全部'}
              </option>
              {subTypeOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* 起始时间 */}
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">起始日期</label>
            <input
              type="date"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              max={endTime || undefined}
              className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>

          {/* 结束时间 */}
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">结束日期</label>
            <input
              type="date"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              min={startTime || undefined}
              className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>

          {/* 搜索 */}
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">关键词</label>
            <div className="relative">
              <SearchIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="搜索标题或描述"
                className="w-full pl-9 pr-9 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-[var(--bg-card-hover)] text-[var(--text-muted)]"
                  aria-label="清空搜索"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* 已选过滤摘要 + 清空 */}
        {activeFilterCount > 0 && (
          <div className="flex items-center justify-between text-sm pt-2 border-t border-[var(--border-subtle)]">
            <span className="text-[var(--text-muted)]">
              已应用 <span className="text-[var(--text-primary)] font-medium">{activeFilterCount}</span> 个筛选条件
              ，匹配 <span className="text-[var(--text-primary)] font-medium">{total}</span> 条记录
            </span>
            <button
              onClick={resetFilters}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] transition-colors"
            >
              <X className="w-3 h-3" />
              清空筛选
            </button>
          </div>
        )}
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
            <p className="text-[var(--text-secondary)]">
              {activeFilterCount > 0 ? '当前筛选条件下暂无活动记录' : '暂无活动记录'}
            </p>
            {activeFilterCount > 0 && (
              <button
                onClick={resetFilters}
                className="mt-3 text-sm text-primary hover:underline"
              >
                清空筛选条件
              </button>
            )}
          </div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div
              key={`${selectedCategory}-${selectedStatus}-${selectedEventType}-${debouncedSearch}-${startTime}-${endTime}-${pageNum}`}
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
                            <div className="flex items-center gap-3 mt-2 text-xs text-[var(--text-muted)] flex-wrap">
                              <span className="font-mono text-[var(--text-muted)]">{item.eventType}</span>
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
