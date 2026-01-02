import { useState } from 'react';
import { cn } from '@/lib/utils';

export default function CategoriesPage() {
  const [activeTab, setActiveTab] = useState<'categories' | 'tags'>('categories');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">分类标签</h1>
        <p className="text-gray-400 mt-1">管理文章分类和标签</p>
      </div>

      {/* 标签页切换 */}
      <div className="flex gap-2 p-1 bg-white/5 rounded-lg w-fit">
        <button
          onClick={() => setActiveTab('categories')}
          className={cn(
            'px-4 py-2 rounded-md text-sm font-medium transition-all',
            activeTab === 'categories'
              ? 'bg-primary text-white'
              : 'text-gray-400 hover:text-white'
          )}
        >
          分类管理
        </button>
        <button
          onClick={() => setActiveTab('tags')}
          className={cn(
            'px-4 py-2 rounded-md text-sm font-medium transition-all',
            activeTab === 'tags'
              ? 'bg-primary text-white'
              : 'text-gray-400 hover:text-white'
          )}
        >
          标签管理
        </button>
      </div>

      {/* 内容区域占位 */}
      <div className="p-6 rounded-xl bg-white/5 border border-white/10">
        <div className="text-center py-12 text-gray-500">
          {activeTab === 'categories' ? '分类树（待实现）' : '标签云（待实现）'}
        </div>
      </div>
    </div>
  );
}
