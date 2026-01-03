import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Plus, Search, Filter, Loader2, Eye, MessageSquare, Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';
import { postService, PostListItem } from '@/services/postService';

export default function PostsPage() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [posts, setPosts] = useState<PostListItem[]>([]);
  const [pagination, setPagination] = useState({ pageNum: 1, pageSize: 10, total: 0, pages: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeStatus, setActiveStatus] = useState<string | undefined>(undefined);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const fetchPosts = async (pageNum = 1, status?: string, keyword?: string) => {
    try {
      setLoading(true);
      const res = await postService.getList({ pageNum, pageSize: 10, status, keyword });
      if (res.code === 200 && res.data) {
        setPosts(res.data.list);
        setPagination({
          pageNum: res.data.pageNum,
          pageSize: res.data.pageSize,
          total: res.data.total,
          pages: res.data.pages,
        });
      } else {
        setError(res.message || '获取文章列表失败');
      }
    } catch (err: any) {
      console.error('Posts fetch error:', err);
      setError(err.message || '网络错误');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPosts(1, activeStatus, debouncedSearch || undefined);
  }, [activeStatus, debouncedSearch]);

  const handleStatusChange = (status: string | undefined) => {
    setActiveStatus(status);
  };

  const handlePageChange = (page: number) => {
    fetchPosts(page, activeStatus, debouncedSearch || undefined);
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('zh-CN');
  };

  const getStatusBadge = (status: string) => {
    const styles = {
      PUBLISHED: 'bg-green-500/20 text-green-400 border-green-500/30',
      DRAFT: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
      ARCHIVED: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
    };
    const labels = { PUBLISHED: '已发布', DRAFT: '草稿', ARCHIVED: '已归档' };
    return (
      <span className={cn('px-2 py-0.5 text-xs rounded-full border', styles[status as keyof typeof styles] || styles.DRAFT)}>
        {labels[status as keyof typeof labels] || status}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">文章管理</h1>
          <p className="text-gray-400 mt-1">共 {pagination.total} 篇文章</p>
        </div>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => navigate('/posts/new')}
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

      {/* 状态筛选标签 */}
      <div className="flex items-center gap-2">
        {[
          { key: undefined, label: '全部' },
          { key: 'PUBLISHED', label: '已发布' },
          { key: 'DRAFT', label: '草稿' },
        ].map((tab) => (
          <button
            key={tab.key ?? 'all'}
            onClick={() => handleStatusChange(tab.key)}
            className={cn(
              'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
              activeStatus === tab.key
                ? 'bg-primary text-white'
                : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
            )}
          >
            {tab.label}
          </button>
        ))}
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

      {/* 文章列表 */}
      <div className="rounded-xl bg-white/5 border border-white/10 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : error ? (
          <div className="p-6 text-center text-red-400">{error}</div>
        ) : posts.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            暂无文章，点击"新建文章"开始创作
          </div>
        ) : (
          <table className="w-full">
            <thead className="border-b border-white/10">
              <tr className="text-left text-gray-400 text-sm">
                <th className="px-6 py-4 font-medium">标题</th>
                <th className="px-6 py-4 font-medium hidden md:table-cell">状态</th>
                <th className="px-6 py-4 font-medium hidden lg:table-cell">浏览</th>
                <th className="px-6 py-4 font-medium hidden lg:table-cell">评论</th>
                <th className="px-6 py-4 font-medium hidden sm:table-cell">发布时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {posts.map((post) => (
                <tr 
                  key={post.id} 
                  onClick={() => navigate(`/posts/${post.id}/edit`)}
                  className="hover:bg-white/5 transition-colors cursor-pointer"
                >
                  <td className="px-6 py-4">
                    <div>
                      <p className="text-white font-medium truncate max-w-xs">{post.title}</p>
                      <p className="text-gray-500 text-sm truncate max-w-xs">{post.summary || '暂无摘要'}</p>
                    </div>
                  </td>
                  <td className="px-6 py-4 hidden md:table-cell">{getStatusBadge(post.status)}</td>
                  <td className="px-6 py-4 hidden lg:table-cell">
                    {post.status === 'PUBLISHED' ? (
                      <span className="flex items-center gap-1 text-gray-400 text-sm">
                        <Eye className="w-4 h-4" /> {post.viewCount}
                      </span>
                    ) : (
                      <span className="text-gray-600 text-sm">-</span>
                    )}
                  </td>
                  <td className="px-6 py-4 hidden lg:table-cell">
                    {post.status === 'PUBLISHED' ? (
                      <span className="flex items-center gap-1 text-gray-400 text-sm">
                        <MessageSquare className="w-4 h-4" /> {post.commentCount}
                      </span>
                    ) : (
                      <span className="text-gray-600 text-sm">-</span>
                    )}
                  </td>
                  <td className="px-6 py-4 hidden sm:table-cell">
                    {post.status === 'PUBLISHED' ? (
                      <span className="flex items-center gap-1 text-gray-400 text-sm">
                        <Calendar className="w-4 h-4" /> {formatDate(post.publishedAt)}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-gray-500 text-sm">
                        <Calendar className="w-4 h-4" /> 创建于 {formatDate(post.createdAt)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 分页 */}
      {pagination.pages > 1 && (
        <div className="flex justify-center gap-2">
          {Array.from({ length: pagination.pages }, (_, i) => i + 1).map((page) => (
            <button
              key={page}
              onClick={() => handlePageChange(page)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-sm transition-colors',
                page === pagination.pageNum
                  ? 'bg-primary text-white'
                  : 'bg-white/5 text-gray-400 hover:bg-white/10'
              )}
            >
              {page}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

