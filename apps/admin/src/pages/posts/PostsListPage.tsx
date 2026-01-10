import { useState, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Plus, Search, Edit, Trash2, Eye, Copy, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { postService, PostListItem } from '@/services/postService';
import { cn } from '@/lib/utils';
import { logger } from '@/lib/logger';

export function PostsListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);

  // Fetch posts with pagination
  const { data, isLoading, error } = useQuery({
    queryKey: ['posts', page, pageSize, selectedStatus, searchTerm],
    queryFn: () => postService.getList({
      pageNum: page,
      pageSize,
      status: selectedStatus || undefined,
      keyword: searchTerm || undefined,
    }),
  });

  const posts = data?.data?.list || [];
  const total = data?.data?.total || 0;
  const totalPages = data?.data?.pages || 1;

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: postService.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['posts'] });
    },
    onError: (err) => {
      logger.error('删除失败:', err);
    },
  });

  // Copy/Duplicate post
  const copyMutation = useMutation({
    mutationFn: async (post: PostListItem) => {
      const original = await postService.getById(post.id);
      if (original.data) {
        return postService.create({
          title: `${original.data.title} (复制)`,
          content: original.data.content,
          summary: original.data.summary,
          coverImage: original.data.coverImage || undefined,
          categoryId: original.data.categoryId || undefined,
          tagIds: original.data.tags.map(t => t.id),
          status: 'DRAFT',
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['posts'] });
    },
    onError: (err) => {
      logger.error('复制失败:', err);
    },
  });

  const handleDelete = useCallback((id: number, title: string) => {
    if (window.confirm(`确定要删除文章 "${title}" 吗？此操作不可恢复。`)) {
      deleteMutation.mutate(id);
    }
  }, [deleteMutation]);

  const handleCopy = useCallback((post: PostListItem) => {
    copyMutation.mutate(post);
  }, [copyMutation]);

  const handleSearch = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    setPage(1); // Reset to first page on search
  }, []);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'PUBLISHED':
        return <span className="px-2 py-1 rounded-full text-xs bg-green-500/20 text-green-400">已发布</span>;
      case 'DRAFT':
        return <span className="px-2 py-1 rounded-full text-xs bg-yellow-500/20 text-yellow-400">草稿</span>;
      case 'ARCHIVED':
        return <span className="px-2 py-1 rounded-full text-xs bg-gray-500/20 text-gray-400">归档</span>;
      default:
        return null;
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">文章管理</h1>
          <p className="text-gray-400 mt-1">共 {total} 篇文章</p>
        </div>
        <Link
          to="/posts/create"
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          新建文章
        </Link>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <form onSubmit={handleSearch} className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="搜索文章标题..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </form>
        <select
          value={selectedStatus}
          onChange={(e) => {
            setSelectedStatus(e.target.value);
            setPage(1);
          }}
          className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-white focus:outline-none focus:ring-2 focus:ring-primary/50"
        >
          <option value="">全部状态</option>
          <option value="PUBLISHED">已发布</option>
          <option value="DRAFT">草稿</option>
          <option value="ARCHIVED">已归档</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
          </div>
        ) : error ? (
          <div className="flex items-center justify-center py-20 text-red-400">
            加载失败，请重试
          </div>
        ) : posts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <p>暂无文章</p>
            <Link to="/posts/create" className="mt-2 text-primary hover:underline">
              创建第一篇文章
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px]">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="px-6 py-4 text-left text-sm font-medium text-gray-400">标题</th>
                  <th className="px-6 py-4 text-left text-sm font-medium text-gray-400 w-24">状态</th>
                  <th className="px-6 py-4 text-left text-sm font-medium text-gray-400 w-20">浏览</th>
                  <th className="px-6 py-4 text-left text-sm font-medium text-gray-400 w-28">创建时间</th>
                  <th className="px-6 py-4 text-right text-sm font-medium text-gray-400 w-36">操作</th>
                </tr>
              </thead>
              <tbody>
                {posts.map((post) => (
                  <tr key={post.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        {post.coverImage && (
                          <img
                            src={post.coverImage}
                            alt=""
                            className="w-12 h-8 rounded object-cover flex-shrink-0"
                          />
                        )}
                        <div className="min-w-0">
                          <Link
                            to={`/posts/edit/${post.id}`}
                            className="text-white font-medium truncate hover:text-primary transition-colors cursor-pointer block"
                          >
                            {post.title}
                          </Link>
                          {post.summary && (
                            <p className="text-gray-500 text-xs truncate mt-0.5">{post.summary}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">{getStatusBadge(post.status)}</td>
                    <td className="px-6 py-4 text-gray-400 text-sm">{post.viewCount.toLocaleString()}</td>
                    <td className="px-6 py-4 text-gray-400 text-sm">{formatDate(post.createdAt)}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-1">
                        {/* View */}
                        <button
                          onClick={() => window.open(`/posts/${post.slug}`, '_blank')}
                          className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                          title="预览"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        {/* Edit */}
                        <button
                          onClick={() => navigate(`/posts/${post.id}/edit`)}
                          className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                          title="编辑"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        {/* Copy */}
                        <button
                          onClick={() => handleCopy(post)}
                          disabled={copyMutation.isPending}
                          className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors disabled:opacity-50"
                          title="复制"
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                        {/* Delete */}
                        <button
                          onClick={() => handleDelete(post.id, post.title)}
                          disabled={deleteMutation.isPending}
                          className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-red-400 transition-colors disabled:opacity-50"
                          title="删除"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <p className="text-gray-400">
            第 {page} 页，共 {totalPages} 页
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className={cn(
                'flex items-center gap-1 px-3 py-2 rounded-lg',
                'border border-white/10 transition-colors',
                page === 1
                  ? 'text-gray-500 cursor-not-allowed'
                  : 'text-white hover:bg-white/5'
              )}
            >
              <ChevronLeft className="w-4 h-4" />
              上一页
            </button>
            
            {/* Page numbers */}
            <div className="flex items-center gap-1">
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum: number;
                if (totalPages <= 5) {
                  pageNum = i + 1;
                } else if (page <= 3) {
                  pageNum = i + 1;
                } else if (page >= totalPages - 2) {
                  pageNum = totalPages - 4 + i;
                } else {
                  pageNum = page - 2 + i;
                }
                return (
                  <button
                    key={pageNum}
                    onClick={() => setPage(pageNum)}
                    className={cn(
                      'w-9 h-9 rounded-lg transition-colors',
                      page === pageNum
                        ? 'bg-primary text-white'
                        : 'text-gray-400 hover:bg-white/5 hover:text-white'
                    )}
                  >
                    {pageNum}
                  </button>
                );
              })}
            </div>

            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className={cn(
                'flex items-center gap-1 px-3 py-2 rounded-lg',
                'border border-white/10 transition-colors',
                page === totalPages
                  ? 'text-gray-500 cursor-not-allowed'
                  : 'text-white hover:bg-white/5'
              )}
            >
              下一页
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default PostsListPage;
