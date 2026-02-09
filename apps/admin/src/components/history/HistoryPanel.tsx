import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  History,
  Clock,
  Bookmark,
  RotateCcw,
  RotateCw,
  Trash2,
  Download,
  Upload,
  X,
  Search,
  Filter,
  ChevronDown,
  Star,
  Sparkles,
  User,
  Save,
  GitBranch,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ContentSnapshot, HistoryState } from '@/types/content-history';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';

interface HistoryPanelProps {
  state: HistoryState;
  currentSnapshotId?: string;
  onJumpTo: (snapshotId: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onToggleBookmark: (snapshotId: string, note?: string) => void;
  onDelete: (snapshotId: string) => void;
  onClear: () => void;
  onCompare: (id1: string, id2: string) => void;
  onClose: () => void;
}

type FilterType = 'all' | 'user' | 'ai' | 'bookmark';

export function HistoryPanel({
  state,
  currentSnapshotId,
  onJumpTo,
  onUndo,
  onRedo,
  onToggleBookmark,
  onDelete,
  onClear,
  onCompare,
  onClose,
}: HistoryPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    new Set(['today', 'yesterday'])
  );
  const [compareMode, setCompareMode] = useState(false);
  const [selectedForCompare, setSelectedForCompare] = useState<string[]>([]);

  // 按时间分组
  const groupedSnapshots = useMemo(() => {
    let filtered = state.snapshots;

    // 过滤
    if (filterType === 'user') {
      filtered = filtered.filter(s => s.source === 'user-edit' || s.source === 'manual-save');
    } else if (filterType === 'ai') {
      filtered = filtered.filter(s => s.source === 'ai-suggestion');
    } else if (filterType === 'bookmark') {
      filtered = filtered.filter(s => s.isBookmark);
    }

    // 搜索
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        s =>
          s.title.toLowerCase().includes(query) ||
          s.content.toLowerCase().includes(query) ||
          s.sourceName?.toLowerCase().includes(query)
      );
    }

    // 分组
    const now = Date.now();
    const today: ContentSnapshot[] = [];
    const yesterday: ContentSnapshot[] = [];
    const thisWeek: ContentSnapshot[] = [];
    const thisMonth: ContentSnapshot[] = [];
    const older: ContentSnapshot[] = [];

    filtered.forEach(snapshot => {
      const age = now - snapshot.timestamp;
      const hours = age / (1000 * 60 * 60);
      const days = hours / 24;

      if (hours < 24) {
        today.push(snapshot);
      } else if (hours < 48) {
        yesterday.push(snapshot);
      } else if (days < 7) {
        thisWeek.push(snapshot);
      } else if (days < 30) {
        thisMonth.push(snapshot);
      } else {
        older.push(snapshot);
      }
    });

    return { today, yesterday, thisWeek, thisMonth, older };
  }, [state.snapshots, filterType, searchQuery]);

  const toggleGroup = (group: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(group)) {
        next.delete(group);
      } else {
        next.add(group);
      }
      return next;
    });
  };

  const handleSnapshotClick = (snapshot: ContentSnapshot) => {
    if (compareMode) {
      setSelectedForCompare(prev => {
        if (prev.includes(snapshot.id)) {
          return prev.filter(id => id !== snapshot.id);
        }
        if (prev.length >= 2) {
          return [prev[1], snapshot.id];
        }
        return [...prev, snapshot.id];
      });
    } else {
      onJumpTo(snapshot.id);
    }
  };

  const handleCompare = () => {
    if (selectedForCompare.length === 2) {
      onCompare(selectedForCompare[0], selectedForCompare[1]);
      setCompareMode(false);
      setSelectedForCompare([]);
    }
  };

  const groups = [
    { key: 'today', label: '今天', items: groupedSnapshots.today },
    { key: 'yesterday', label: '昨天', items: groupedSnapshots.yesterday },
    { key: 'thisWeek', label: '本周', items: groupedSnapshots.thisWeek },
    { key: 'thisMonth', label: '本月', items: groupedSnapshots.thisMonth },
    { key: 'older', label: '更早', items: groupedSnapshots.older },
  ].filter(g => g.items.length > 0);

  return (
    <motion.div
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: 360, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className="h-full border-l border-[var(--border-subtle)] bg-[var(--bg-card)] flex flex-col overflow-hidden"
    >
      {/* 头部 */}
      <div className="px-4 py-3 border-b border-[var(--border-subtle)] space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <History className="w-5 h-5 text-primary" />
            <h3 className="font-semibold text-[var(--text-primary)]">版本历史</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[var(--bg-card-hover)] text-[var(--text-muted)]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 快捷操作 */}
        <div className="flex items-center gap-2">
          <button
            onClick={onUndo}
            disabled={!state.canUndo}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm transition-colors',
              state.canUndo
                ? 'bg-[var(--bg-secondary)] hover:bg-[var(--bg-card-hover)] text-[var(--text-primary)]'
                : 'bg-[var(--bg-secondary)] text-[var(--text-muted)] opacity-50 cursor-not-allowed'
            )}
            title="撤销 (Ctrl+Z)"
          >
            <RotateCcw className="w-4 h-4" />
            <span>撤销</span>
          </button>
          <button
            onClick={onRedo}
            disabled={!state.canRedo}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm transition-colors',
              state.canRedo
                ? 'bg-[var(--bg-secondary)] hover:bg-[var(--bg-card-hover)] text-[var(--text-primary)]'
                : 'bg-[var(--bg-secondary)] text-[var(--text-muted)] opacity-50 cursor-not-allowed'
            )}
            title="重做 (Ctrl+Shift+Z)"
          >
            <RotateCw className="w-4 h-4" />
            <span>重做</span>
          </button>
        </div>

        {/* 搜索框 */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索历史版本..."
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-primary/50"
          />
        </div>

        {/* 过滤器 */}
        <div className="flex items-center gap-2">
          {([
            { value: 'all', label: '全部', icon: Clock },
            { value: 'user', label: '手动', icon: User },
            { value: 'ai', label: 'AI', icon: Sparkles },
            { value: 'bookmark', label: '书签', icon: Bookmark },
          ] as const).map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              onClick={() => setFilterType(value)}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs transition-colors',
                filterType === value
                  ? 'bg-primary/10 text-primary border border-primary/30'
                  : 'bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-transparent'
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{label}</span>
            </button>
          ))}
        </div>

        {/* 对比模式 */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setCompareMode(!compareMode);
              setSelectedForCompare([]);
            }}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm transition-colors',
              compareMode
                ? 'bg-primary/10 text-primary border border-primary/30'
                : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)]'
            )}
          >
            <GitBranch className="w-4 h-4" />
            <span>{compareMode ? '取消对比' : '对比模式'}</span>
          </button>
          {compareMode && selectedForCompare.length === 2 && (
            <button
              onClick={handleCompare}
              className="px-3 py-2 rounded-lg bg-primary text-white text-sm hover:bg-primary/90"
            >
              开始对比
            </button>
          )}
        </div>
      </div>

      {/* 列表 */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-[var(--text-muted)]">
            <History className="w-12 h-12 mb-3 opacity-20" />
            <p className="text-sm">暂无历史版本</p>
          </div>
        ) : (
          groups.map(group => (
            <div key={group.key}>
              <button
                onClick={() => toggleGroup(group.key)}
                className="w-full flex items-center justify-between px-2 py-1.5 rounded-md hover:bg-[var(--bg-card-hover)] transition-colors group"
              >
                <span className="text-xs font-medium text-[var(--text-muted)] group-hover:text-[var(--text-primary)]">
                  {group.label} ({group.items.length})
                </span>
                <ChevronDown
                  className={cn(
                    'w-4 h-4 text-[var(--text-muted)] transition-transform',
                    expandedGroups.has(group.key) && 'rotate-180'
                  )}
                />
              </button>

              <AnimatePresence>
                {expandedGroups.has(group.key) && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-1 mt-1 overflow-hidden"
                  >
                    {group.items.map(snapshot => (
                      <SnapshotItem
                        key={snapshot.id}
                        snapshot={snapshot}
                        isCurrent={snapshot.id === currentSnapshotId}
                        isSelected={compareMode && selectedForCompare.includes(snapshot.id)}
                        compareMode={compareMode}
                        onClick={() => handleSnapshotClick(snapshot)}
                        onToggleBookmark={(note) => onToggleBookmark(snapshot.id, note)}
                        onDelete={() => onDelete(snapshot.id)}
                      />
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))
        )}
      </div>

      {/* 底部统计 */}
      <div className="px-4 py-3 border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)]/50">
        <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
          <span>共 {state.totalSnapshots} 个版本</span>
          <span>{(state.totalSize / 1024).toFixed(1)} KB</span>
        </div>
      </div>
    </motion.div>
  );
}

// ==================== 快照条目组件 ====================

interface SnapshotItemProps {
  snapshot: ContentSnapshot;
  isCurrent: boolean;
  isSelected: boolean;
  compareMode: boolean;
  onClick: () => void;
  onToggleBookmark: (note?: string) => void;
  onDelete: () => void;
}

function SnapshotItem({
  snapshot,
  isCurrent,
  isSelected,
  compareMode,
  onClick,
  onToggleBookmark,
  onDelete,
}: SnapshotItemProps) {
  const sourceIcon = getSourceIcon(snapshot.source);
  const timeAgo = formatDistanceToNow(snapshot.timestamp, {
    addSuffix: true,
    locale: zhCN,
  });

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full group relative flex items-start gap-3 px-3 py-2.5 rounded-lg transition-all text-left',
        isCurrent && 'bg-primary/10 border border-primary/30',
        !isCurrent && 'hover:bg-[var(--bg-card-hover)] border border-transparent',
        isSelected && 'bg-blue-500/10 border-blue-500/30'
      )}
    >
      {/* 图标 */}
      <div className={cn(
        'w-7 h-7 rounded-full flex items-center justify-center shrink-0',
        snapshot.source === 'ai-suggestion' ? 'bg-purple-500/10' : 'bg-blue-500/10'
      )}>
        {sourceIcon}
      </div>

      {/* 内容 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-[var(--text-primary)] truncate">
              {snapshot.title || '未命名'}
            </p>
            {snapshot.sourceName && (
              <p className="text-xs text-[var(--text-muted)] truncate mt-0.5">
                {snapshot.sourceName}
              </p>
            )}
          </div>
          {snapshot.isBookmark && (
            <Star className="w-3.5 h-3.5 text-yellow-500 fill-yellow-500 shrink-0" />
          )}
        </div>

        <div className="flex items-center gap-2 mt-1.5 text-xs text-[var(--text-muted)]">
          <span>{timeAgo}</span>
          {snapshot.changedChars !== 0 && (
            <>
              <span>·</span>
              <span className={snapshot.changedChars > 0 ? 'text-emerald-500' : 'text-red-500'}>
                {snapshot.changedChars > 0 ? '+' : ''}{snapshot.changedChars}
              </span>
            </>
          )}
        </div>
      </div>

      {/* 操作按钮 */}
      {!compareMode && (
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleBookmark();
            }}
            className="p-1 rounded hover:bg-[var(--bg-secondary)]"
            title={snapshot.isBookmark ? '取消书签' : '添加书签'}
          >
            <Bookmark className={cn(
              'w-3.5 h-3.5',
              snapshot.isBookmark ? 'text-yellow-500 fill-yellow-500' : 'text-[var(--text-muted)]'
            )} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="p-1 rounded hover:bg-red-500/10 text-[var(--text-muted)] hover:text-red-500"
            title="删除"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 当前标记 */}
      {isCurrent && (
        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-primary rounded-r" />
      )}
    </button>
  );
}

function getSourceIcon(source: ContentSnapshot['source']) {
  const iconMap = {
    'user-edit': <User className="w-4 h-4 text-blue-500" />,
    'ai-suggestion': <Sparkles className="w-4 h-4 text-purple-500" />,
    'auto-save': <Clock className="w-4 h-4 text-[var(--text-muted)]" />,
    'manual-save': <Save className="w-4 h-4 text-green-500" />,
    'workflow-stage': <GitBranch className="w-4 h-4 text-orange-500" />,
    'import': <Upload className="w-4 h-4 text-cyan-500" />,
  };
  return iconMap[source] || <Clock className="w-4 h-4 text-[var(--text-muted)]" />;
}
