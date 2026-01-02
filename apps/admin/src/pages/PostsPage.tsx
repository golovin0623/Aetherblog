import { useState } from 'react';
import { motion } from 'framer-motion';
import { Plus, Search, Filter } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function PostsPage() {
  const [searchQuery, setSearchQuery] = useState('');

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">文章管理</h1>
          <p className="text-gray-400 mt-1">管理您的博客文章</p>
        </div>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-lg',
            'bg-primary text-white font-medium',
            'hover:bg-primary/90 transition-colors'
          )}
        >
          <Plus className="w-4 h-4" />
          新建文章
        </motion.button>
      </div>

      {/* 搜索和筛选 */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="搜索文章..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={cn(
              'w-full pl-10 pr-4 py-2.5 rounded-lg',
              'bg-white/5 border border-white/10',
              'text-white placeholder-gray-500',
              'focus:outline-none focus:border-primary/50',
              'transition-colors duration-200'
            )}
          />
        </div>
        <button
          className={cn(
            'flex items-center gap-2 px-4 py-2.5 rounded-lg',
            'bg-white/5 border border-white/10 text-gray-300',
            'hover:bg-white/10 transition-colors'
          )}
        >
          <Filter className="w-4 h-4" />
          筛选
        </button>
      </div>

      {/* 文章列表占位 */}
      <div className="p-6 rounded-xl bg-white/5 border border-white/10">
        <div className="text-center py-12 text-gray-500">
          文章列表（待实现）
        </div>
      </div>
    </div>
  );
}
