import { Eye, TrendingUp, ArrowUpRight } from 'lucide-react';
import { motion } from 'framer-motion';
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

export function TopPosts({ posts, loading }: TopPostsProps) {
  if (loading) {
    return (
      <div className="p-6 rounded-xl bg-white/5 border border-white/10 h-[420px]">
        <div className="flex justify-between items-center mb-6">
           <div className="w-24 h-6 bg-white/10 rounded animate-pulse" />
           <div className="w-16 h-4 bg-white/10 rounded animate-pulse" />
        </div>
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex items-center gap-4 p-3 rounded-lg bg-white/5 animate-pulse relative overflow-hidden">
              {/* Shimmer effect */}
              <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/5 to-transparent" />
              <div className="w-8 h-8 bg-white/10 rounded-lg flex-shrink-0" />
              <div className="flex-1 h-4 bg-white/10 rounded" />
              <div className="w-12 h-4 bg-white/10 rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] h-full flex flex-col">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">热门文章</h3>
        <button className="text-[var(--text-muted)] hover:text-primary transition-colors">
          <ArrowUpRight className="w-5 h-5" />
        </button>
      </div>
      <div className="space-y-2 flex-1 overflow-y-auto">
        {posts.map((post, index) => (
            <div
              key={post.id}
              className="flex items-center gap-4 p-3 rounded-lg hover:bg-[var(--bg-card-hover)] transition-colors group cursor-pointer"
            >
              <div className={cn(
                "w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm",
                index < 3
                  ? "bg-primary/20 text-primary border border-primary/20"
                  : "bg-[var(--bg-secondary)] text-[var(--text-muted)] border border-[var(--border-subtle)]"
              )}>
                {index + 1}
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-medium text-[var(--text-primary)] truncate group-hover:text-primary transition-colors">
                  {post.title}
                </h4>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] group-hover:text-[var(--text-secondary)] transition-colors">
                <Eye className="w-3.5 h-3.5" />
                <span>{post.viewCount.toLocaleString()}</span>
              </div>
            </div>
        ))}

        {posts.length === 0 && (
          <div className="text-center py-10 text-gray-500 text-sm">
            暂无热门文章数据
          </div>
        )}
      </div>
    </div>
  );
}

export default TopPosts;
