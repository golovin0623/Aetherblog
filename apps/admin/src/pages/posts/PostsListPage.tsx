import { useState } from 'react';
import { Plus, Search, Edit, Trash2, Eye } from 'lucide-react';

export function PostsListPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('all');

  const posts = [
    { id: 1, title: '示例文章标题', status: 'PUBLISHED', views: 1234, createdAt: '2024-01-01' },
    { id: 2, title: '草稿文章', status: 'DRAFT', views: 0, createdAt: '2024-01-02' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">文章管理</h1>
          <p className="text-gray-400 mt-1">管理所有文章内容</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors">
          <Plus className="w-4 h-4" />
          新建文章
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="搜索文章..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
        <select
          value={selectedStatus}
          onChange={(e) => setSelectedStatus(e.target.value)}
          className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-white focus:outline-none focus:ring-2 focus:ring-primary/50"
        >
          <option value="all">全部状态</option>
          <option value="PUBLISHED">已发布</option>
          <option value="DRAFT">草稿</option>
          <option value="ARCHIVED">已归档</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/10">
              <th className="px-6 py-4 text-left text-sm font-medium text-gray-400">标题</th>
              <th className="px-6 py-4 text-left text-sm font-medium text-gray-400">状态</th>
              <th className="px-6 py-4 text-left text-sm font-medium text-gray-400">浏览</th>
              <th className="px-6 py-4 text-left text-sm font-medium text-gray-400">创建时间</th>
              <th className="px-6 py-4 text-right text-sm font-medium text-gray-400">操作</th>
            </tr>
          </thead>
          <tbody>
            {posts.map((post) => (
              <tr key={post.id} className="border-b border-white/5 hover:bg-white/5">
                <td className="px-6 py-4 text-white">{post.title}</td>
                <td className="px-6 py-4">
                  <span className={`px-2 py-1 rounded-full text-xs ${
                    post.status === 'PUBLISHED' ? 'bg-green-500/20 text-green-400' :
                    post.status === 'DRAFT' ? 'bg-yellow-500/20 text-yellow-400' :
                    'bg-gray-500/20 text-gray-400'
                  }`}>
                    {post.status === 'PUBLISHED' ? '已发布' : post.status === 'DRAFT' ? '草稿' : '归档'}
                  </span>
                </td>
                <td className="px-6 py-4 text-gray-400">{post.views}</td>
                <td className="px-6 py-4 text-gray-400">{post.createdAt}</td>
                <td className="px-6 py-4">
                  <div className="flex items-center justify-end gap-2">
                    <button className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors">
                      <Eye className="w-4 h-4" />
                    </button>
                    <button className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors">
                      <Edit className="w-4 h-4" />
                    </button>
                    <button className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-red-400 transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default PostsListPage;
