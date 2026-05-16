import { Eye, ArrowUpRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';

export interface TopPost {
  id: number;
  title: string;
  viewCount: number;
}

interface TopPostsProps {
  posts: TopPost[];
  loading?: boolean;
}

const RANK_STYLES = [
  'bg-gradient-to-br from-[color-mix(in_oklch,var(--dashboard-aurora-1)_28%,transparent)] to-[color-mix(in_oklch,var(--dashboard-aurora-5)_14%,transparent)] text-[var(--dashboard-aurora-1)] border border-[color-mix(in_oklch,var(--dashboard-aurora-1)_38%,transparent)] shadow-[0_0_12px_color-mix(in_oklch,var(--dashboard-aurora-1)_24%,transparent)]',
  'bg-gradient-to-br from-[color-mix(in_oklch,var(--dashboard-aurora-4)_24%,transparent)] to-[color-mix(in_oklch,var(--dashboard-aurora-8)_12%,transparent)] text-[var(--dashboard-aurora-4)] border border-[color-mix(in_oklch,var(--dashboard-aurora-4)_34%,transparent)] shadow-[0_0_10px_color-mix(in_oklch,var(--dashboard-aurora-4)_20%,transparent)]',
  'bg-gradient-to-br from-[color-mix(in_oklch,var(--dashboard-aurora-7)_24%,transparent)] to-[color-mix(in_oklch,var(--dashboard-aurora-11)_12%,transparent)] text-[var(--dashboard-aurora-7)] border border-[color-mix(in_oklch,var(--dashboard-aurora-7)_34%,transparent)] shadow-[0_0_10px_color-mix(in_oklch,var(--dashboard-aurora-7)_20%,transparent)]',
];

const TOP_POSTS_VISIBLE_LIMIT = 8;

export function TopPosts({ posts, loading }: TopPostsProps) {
  const navigate = useNavigate();
  const visiblePosts = posts.slice(0, TOP_POSTS_VISIBLE_LIMIT);

  const handleViewAll = () => {
    navigate('/posts?sortBy=viewCount&sortOrder=desc&from=dashboard');
  };

  const handleOpenPost = (id: number) => {
    navigate(`/posts/edit/${id}`);
  };

  if (loading) {
    return (
      <div className="surface-leaf surface-dashboard-card p-6 rounded-xl h-[420px]">
        <div className="flex justify-between items-center mb-6">
           <div className="w-24 h-6 bg-[var(--bg-secondary)] rounded animate-pulse" />
           <div className="w-16 h-4 bg-[var(--bg-secondary)] rounded animate-pulse" />
        </div>
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex items-center gap-4 p-3 rounded-lg bg-[var(--bg-secondary)] animate-pulse relative overflow-hidden">
              {/* 微光效果 */}
              <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-[var(--bg-card-hover)] to-transparent" />
              <div className="w-8 h-8 bg-[var(--bg-secondary)] rounded-lg flex-shrink-0" />
              <div className="flex-1 h-4 bg-[var(--bg-secondary)] rounded" />
              <div className="w-12 h-4 bg-[var(--bg-secondary)] rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="surface-leaf surface-dashboard-card p-6 rounded-xl h-full flex flex-col">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">热门文章</h3>
        <button
          type="button"
          onClick={handleViewAll}
          className="-m-2 p-2 rounded-lg text-[var(--text-muted)] hover:text-[var(--dashboard-aurora-1)] hover:bg-[var(--bg-card-hover)] active:bg-[var(--bg-card-hover)] transition-colors touch-manipulation"
          aria-label="查看更多"
        >
          <ArrowUpRight className="w-5 h-5" />
        </button>
      </div>
      <div className="space-y-2 flex-1 overflow-y-auto">
        {visiblePosts.map((post, index) => (
            <button
              key={post.id}
              type="button"
              onClick={() => handleOpenPost(post.id)}
              className="w-full text-left flex items-center gap-4 p-3 rounded-lg hover:bg-[var(--bg-card-hover)] active:bg-[var(--bg-card-hover)] transition-colors group cursor-pointer touch-manipulation"
            >
              <div className={cn(
                "w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm flex-shrink-0",
                index < 3
                  ? RANK_STYLES[index]
                  : "bg-[var(--bg-secondary)] text-[var(--text-muted)] border border-[var(--border-subtle)]"
              )}>
                {index + 1}
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-medium text-[var(--text-primary)] truncate group-hover:text-[var(--dashboard-aurora-1)] transition-colors">
                  {post.title}
                </h4>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] group-hover:text-[var(--text-secondary)] transition-colors">
                <Eye className="w-3.5 h-3.5" />
                <span className="tnum">{post.viewCount.toLocaleString()}</span>
              </div>
            </button>
        ))}

        {visiblePosts.length === 0 && (
          <div className="text-center py-10 text-[var(--text-muted)] text-sm">
            暂无热门文章数据
          </div>
        )}
      </div>
    </div>
  );
}

export default TopPosts;
