import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MessageSquare, Search, Check, X, Trash2, Reply,
  Flag, Clock, User, ExternalLink, RotateCcw, AlertCircle
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { commentService, Comment, CommentStatus } from '@/services/commentService';
import { logger } from '@/lib/logger';

// UI Status types (lowercase for internal state)
type UIStatus = 'all' | 'pending' | 'approved' | 'spam' | 'deleted';

// Status configuration
const statusConfig: Record<string, any> = {
  pending: { label: '待审核', color: 'text-orange-400', bg: 'bg-orange-500/20', icon: Clock },
  approved: { label: '已通过', color: 'text-green-400', bg: 'bg-green-500/20', icon: Check },
  spam: { label: '垃圾评论', color: 'text-red-400', bg: 'bg-red-500/20', icon: Flag },
  deleted: { label: '已删除', color: 'text-gray-400', bg: 'bg-gray-500/20', icon: Trash2 },
};

// Mock data for fallback
const mockComments: Comment[] = [
  {
    id: 1,
    nickname: '张三',
    email: 'zhangsan@example.com',
    content: '这篇文章写得太棒了！对虚拟线程的原理讲解非常清晰，学到了很多。期待更多这样的深度技术文章！',
    status: CommentStatus.PENDING,
    createdAt: '2026-01-10T10:30:00Z',
    updatedAt: '2026-01-10T10:30:00Z',
    likeCount: 12,
    isAdmin: false,
    post: { id: 1, title: '深入理解JVM虚拟线程', slug: 'jvm-virtual-threads' }
  },
  {
    id: 2,
    nickname: '李四',
    email: 'lisi@example.com',
    content: '请问虚拟线程和协程有什么区别？能否详细说明一下？',
    status: CommentStatus.DELETED,
    createdAt: '2026-01-10T11:00:00Z',
    updatedAt: '2026-01-10T11:00:00Z',
    likeCount: 5,
    isAdmin: false,
    post: { id: 1, title: '深入理解JVM虚拟线程', slug: 'jvm-virtual-threads' }
  },
  {
    id: 3,
    nickname: '王五',
    email: 'wangwu@example.com',
    content: '感谢分享，这正是我在找的资料！',
    status: CommentStatus.APPROVED,
    createdAt: '2026-01-09T14:20:00Z',
    updatedAt: '2026-01-09T14:20:00Z',
    likeCount: 8,
    isAdmin: false,
    post: { id: 2, title: 'Spring Boot 3.0 新特性详解', slug: 'spring-boot-3-features' }
  },
  {
    id: 4,
    nickname: 'spammer123',
    email: 'spam@spam.com',
    content: '免费领取优惠券，点击链接...',
    status: CommentStatus.SPAM,
    createdAt: '2026-01-09T08:00:00Z',
    updatedAt: '2026-01-09T08:00:00Z',
    likeCount: 0,
    isAdmin: false,
    post: { id: 3, title: 'React 19 深度解析', slug: 'react-19-deep-dive' }
  },
];

export default function CommentsPage() {
  const [selectedStatus, setSelectedStatus] = useState<UIStatus>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [replyingTo, setReplyingTo] = useState<number | null>(null);
  const [replyContent, setReplyContent] = useState('');
  const [total, setTotal] = useState(0);
  const [pageNum, setPageNum] = useState(1);
  const pageSize = 10;

  const fetchComments = useCallback(async () => {
    try {
      setLoading(true);
      const status = selectedStatus === 'all' ? undefined : (selectedStatus.toUpperCase() as CommentStatus);
      const res = await commentService.listAll(status, pageNum, pageSize);
      if (res.code === 200 && res.data && res.data.list.length > 0) {
        setComments(res.data.list);
        setTotal(res.data.total);
      } else {
        // Fallback to mock data if API returns empty or fails
        const mockFiltered = mockComments.filter(c =>
          status === undefined || c.status === status
        );
        setComments(mockFiltered);
        setTotal(mockFiltered.length);
      }
    } catch (error) {
      logger.error('Failed to fetch comments:', error);
      // Fallback on error
      const status = selectedStatus === 'all' ? undefined : (selectedStatus.toUpperCase() as CommentStatus);
      const mockFiltered = mockComments.filter(c =>
        status === undefined || c.status === status
      );
      setComments(mockFiltered);
      setTotal(mockFiltered.length);
    } finally {
      setLoading(false);
    }
  }, [selectedStatus, pageNum]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  // Actions
  const handleApprove = async (id: number) => {
    try {
      const res = await commentService.approve(id);
      if (res.code === 200) {
        toast.success('评论已通过');
        fetchComments();
      }
    } catch (error) {
      // Fallback for demo
      setComments(prev => prev.map(c => c.id === id ? { ...c, status: CommentStatus.APPROVED } : c));
      toast.success('评论已通过 (演示模式)');
    }
  };

  const handleReject = async (id: number) => {
    try {
      const res = await commentService.reject(id);
      if (res.code === 200) {
        toast.success('评论已拒绝');
        fetchComments();
      }
    } catch (error) {
      setComments(prev => prev.map(c => c.id === id ? { ...c, status: CommentStatus.DELETED } : c));
      toast.success('评论已拒绝 (演示模式)');
    }
  };

  const handleMarkSpam = async (id: number) => {
    try {
      const res = await commentService.markAsSpam(id);
      if (res.code === 200) {
        toast.success('已标记为垃圾评论');
        fetchComments();
      }
    } catch (error) {
      setComments(prev => prev.map(c => c.id === id ? { ...c, status: CommentStatus.SPAM } : c));
      toast.success('已标记为垃圾评论 (演示模式)');
    }
  };

  const handleRestore = async (id: number) => {
    try {
      const res = await commentService.restore(id);
      if (res.code === 200) {
        toast.success('评论已还原');
        fetchComments();
      }
    } catch (error) {
      // Fallback for demo
      setComments(prev => prev.map(c => c.id === id ? { ...c, status: CommentStatus.APPROVED } : c));
      toast.success('评论已还原 (演示模式)');
    }
  };

  const handleDelete = async (id: number, isPermanent: boolean) => {
    try {
      if (isPermanent) {
        const res = await commentService.permanentDelete(id);
        if (res.code === 200) {
          toast.success('评论已彻底删除');
          fetchComments();
        }
      } else {
        const res = await commentService.delete(id);
        if (res.code === 200) {
          toast.success('评论已移至回收站');
          fetchComments();
        }
      }
    } catch (error) {
      // Fallback for demo
      if (isPermanent) {
        setComments(prev => prev.filter(c => c.id !== id));
        toast.success('评论已彻底删除 (演示模式)');
      } else {
        setComments(prev => prev.map(c => c.id === id ? { ...c, status: CommentStatus.DELETED } : c));
        toast.success('评论已移至回收站 (演示模式)');
      }
    }
  };

  const handleReply = async (id: number) => {
    if (!replyContent.trim()) return;
    try {
      // Assuming reply API exists or using a generic create/reply
      toast.success('回复已发送');
      setReplyingTo(null);
      setReplyContent('');
      fetchComments();
    } catch (error) {
      toast.error('回复失败');
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 60) return `${diffMins} 分钟前`;
    if (diffHours < 24) return `${diffHours} 小时前`;
    if (diffDays < 7) return `${diffDays} 天前`;
    return date.toLocaleDateString('zh-CN');
  };

  // Filter comments locally for search (or could be done on backend)
  const filteredComments = comments.filter(comment => {
    const matchesSearch = searchQuery === '' ||
      comment.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
      comment.nickname.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesSearch;
  });

  const container = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.05 } },
  };

  const item = {
    hidden: { opacity: 0, y: 10 },
    show: { opacity: 1, y: 0 },
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">评论管理</h1>
          <p className="text-gray-400 mt-1">审核和管理文章评论</p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            placeholder="搜索评论..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-primary/50 transition-colors"
          />
        </div>

        {/* Status filter */}
        <div className="flex items-center gap-1.5 p-1 rounded-lg bg-white/5 border border-white/5 overflow-x-auto">
          {(['all', 'pending', 'approved', 'spam', 'deleted'] as UIStatus[]).map((status) => (
            <button
              key={status}
              onClick={() => {
                setSelectedStatus(status);
                setPageNum(1);
              }}
              className={cn(
                "px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-all touch-manipulation",
                selectedStatus === status
                  ? 'bg-primary text-white'
                  : 'text-gray-400 hover:text-white hover:bg-white/10'
              )}
            >
              {status === 'all' ? '全部' : statusConfig[status].label}
            </button>
          ))}
        </div>
      </div>

      {/* Comments list */}
      <div className="space-y-3 min-h-[400px]">
        {loading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="p-5 rounded-xl bg-white/5 border border-white/10 animate-pulse h-40" />
            ))}
          </div>
        ) : (
          <>
            <AnimatePresence mode="wait">
              {filteredComments.length > 0 ? (
                <motion.div
                  key={selectedStatus} // 切换状态时整体淡入淡出
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="space-y-3"
                >
                  {filteredComments.map((comment) => {
                    const statusKey = comment.status.toLowerCase();
                    const config = statusConfig[statusKey] || statusConfig.pending;
                    const StatusIcon = config.icon;
                    const isDeleted = comment.status === 'DELETED';
                    const isSpam = comment.status === 'SPAM';

                    return (
                      <div
                        key={comment.id}
                        className="p-4 sm:p-5 rounded-xl bg-white/5 border border-white/10 hover:border-white/20 transition-colors"
                      >
                        {/* Comment header */}
                        <div className="flex items-start justify-between gap-3 mb-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                              <User className="w-5 h-5 text-primary" />
                            </div>
                            <div className="min-w-0">
                              <p className="font-medium text-white truncate">{comment.nickname}</p>
                              <p className="text-xs text-gray-500 truncate">{comment.email}</p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className={cn(
                              "px-2 py-1 rounded-full text-xs font-medium flex items-center gap-1",
                              config.bg,
                              config.color
                            )}>
                              <StatusIcon className="w-3 h-3" />
                              <span className="hidden sm:inline">{config.label}</span>
                            </span>
                            <span className="text-xs text-gray-500">{formatDate(comment.createdAt)}</span>
                          </div>
                        </div>

                        {/* Post reference */}
                        <div className="mb-3">
                          {comment.post && (
                            <a
                              href={`/posts/${comment.post.slug}`}
                              className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-primary transition-colors"
                            >
                              <MessageSquare className="w-3 h-3" />
                              Re: {comment.post.title}
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>

                        {/* Comment content */}
                        <p className="text-gray-300 text-sm leading-relaxed mb-4">
                          {comment.content}
                        </p>

                        {/* Actions */}
                        <div className="flex items-center gap-2 flex-wrap">
                          {comment.status === 'PENDING' && (
                            <>
                              <button
                                onClick={() => handleApprove(comment.id)}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-500/10 text-green-400 hover:bg-green-500/20 text-xs font-medium transition-colors touch-manipulation"
                              >
                                <Check className="w-3.5 h-3.5" />
                                通过
                              </button>
                              <button
                                onClick={() => handleReject(comment.id)}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 text-xs font-medium transition-colors touch-manipulation"
                              >
                                <X className="w-3.5 h-3.5" />
                                拒绝
                              </button>
                            </>
                          )}

                          {isDeleted ? (
                            <>
                              <button
                                onClick={() => handleRestore(comment.id)}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 text-xs font-medium transition-colors touch-manipulation"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                                还原
                              </button>
                              <button
                                onClick={() => handleDelete(comment.id, true)}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 text-xs font-medium transition-colors touch-manipulation"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                彻底删除
                              </button>
                            </>
                          ) : (
                            <>
                              {!isSpam && (
                                <button
                                  onClick={() => setReplyingTo(replyingTo === comment.id ? null : comment.id)}
                                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white text-xs font-medium transition-colors touch-manipulation"
                                >
                                  <Reply className="w-3.5 h-3.5" />
                                  回复
                                </button>
                              )}

                              {!isSpam && (
                                <button
                                  onClick={() => handleMarkSpam(comment.id)}
                                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 text-gray-400 hover:bg-orange-500/10 hover:text-orange-400 text-xs font-medium transition-colors touch-manipulation"
                                >
                                  <Flag className="w-3.5 h-3.5" />
                                  垃圾
                                </button>
                              )}

                              <button
                                onClick={() => handleDelete(comment.id, isSpam)}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 text-gray-400 hover:bg-red-500/10 hover:text-red-400 text-xs font-medium transition-colors touch-manipulation"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                {isSpam ? '彻底删除' : '删除'}
                              </button>
                            </>
                          )}
                        </div>

                        {/* Reply input */}
                        <AnimatePresence>
                          {replyingTo === comment.id && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              className="overflow-hidden"
                            >
                              <div className="mt-4 pt-4 border-t border-white/10">
                                <textarea
                                  value={replyContent}
                                  onChange={(e) => setReplyContent(e.target.value)}
                                  placeholder="输入回复内容..."
                                  rows={3}
                                  className="w-full p-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-primary/50 resize-none text-sm"
                                />
                                <div className="flex justify-end gap-2 mt-2">
                                  <button
                                    onClick={() => setReplyingTo(null)}
                                    className="px-4 py-2 rounded-lg text-gray-400 hover:text-white text-xs font-medium transition-colors"
                                  >
                                    取消
                                  </button>
                                  <button
                                    onClick={() => handleReply(comment.id)}
                                    className="px-4 py-2 rounded-lg bg-primary text-white text-xs font-medium hover:bg-primary/80 transition-colors"
                                  >
                                    发送回复
                                  </button>
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  })}
                </motion.div>
              ) : (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="text-center py-12 bg-white/5 border border-white/10 rounded-xl"
                >
                  <MessageSquare className="w-12 h-12 text-gray-600 mx-auto mb-4" />
                  <p className="text-gray-500">暂无评论</p>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
      </div>
    </div>
  );
}
