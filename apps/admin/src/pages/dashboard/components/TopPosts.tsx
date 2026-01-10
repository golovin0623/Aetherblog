import { Eye, TrendingUp, ArrowUpRight } from 'lucide-react';
import { motion } from 'framer-motion';

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
      <div className="p-6 rounded-xl bg-white/5 border border-white/10 h-[380px]">
        <div className="flex justify-between items-center mb-6">
           <div className="w-24 h-6 bg-white/10 rounded" />
           <div className="w-16 h-4 bg-white/10 rounded" />
        </div>
        <div className="space-y-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex items-center gap-4 p-2">
              <div className="w-8 h-8 bg-white/10 rounded-lg" />
              <div className="flex-1 h-4 bg-white/10 rounded" />
              <div className="w-12 h-4 bg-white/10 rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 rounded-xl bg-white/5 border border-white/10 h-full">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-primary" />
          热门文章
        </h3>
        <button className="text-sm text-primary hover:text-primary/80 transition-colors flex items-center gap-1">
          查看全部 <ArrowUpRight className="w-3 h-3" />
        </button>
      </div>
      <div className="space-y-2">
        {posts.map((post, index) => (
          <motion.div
            key={post.id}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.1 }}
            className="flex items-center gap-4 p-3 rounded-lg hover:bg-white/5 transition-colors group cursor-pointer"
          >
            <div className={`
              w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold shadow-sm
              ${index === 0 ? 'bg-yellow-500/10 text-yellow-500 border border-yellow-500/20' : 
                index === 1 ? 'bg-gray-400/10 text-gray-400 border border-gray-400/20' : 
                index === 2 ? 'bg-orange-500/10 text-orange-500 border border-orange-500/20' : 
                'bg-white/5 text-gray-500 border border-white/10'}
            `}>
              {index + 1}
            </div>
            
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-200 truncate group-hover:text-white transition-colors">
                {post.title}
              </p>
            </div>

            <div className="flex items-center gap-1.5 text-xs text-gray-500 group-hover:text-primary transition-colors">
              <Eye className="w-3.5 h-3.5" />
              <span>{post.viewCount.toLocaleString()}</span>
            </div>
          </motion.div>
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
