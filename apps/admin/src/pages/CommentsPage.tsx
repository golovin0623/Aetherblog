import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  MessageSquare, Search, Check, X, Trash2, Reply, 
  Flag, Clock, User, ExternalLink, Filter, MoreVertical 
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

// Comment status types
type CommentStatus = 'all' | 'pending' | 'approved' | 'spam' | 'trash';

interface Comment {
  id: number;
  author: string;
  email: string;
  avatar?: string;
  content: string;
  postTitle: string;
  postSlug: string;
  status: 'pending' | 'approved' | 'spam' | 'trash';
  createdAt: string;
  likes: number;
}

// Status configuration
const statusConfig = {
  pending: { label: '待审核', color: 'text-orange-400', bg: 'bg-orange-500/20', icon: Clock },
  approved: { label: '已通过', color: 'text-green-400', bg: 'bg-green-500/20', icon: Check },
  spam: { label: '垃圾评论', color: 'text-red-400', bg: 'bg-red-500/20', icon: Flag },
  trash: { label: '已删除', color: 'text-gray-400', bg: 'bg-gray-500/20', icon: Trash2 },
};

// Mock data
const mockComments: Comment[] = [
  {
    id: 1,
    author: '张三',
    email: 'zhangsan@example.com',
    content: '这篇文章写得太棒了！对虚拟线程的原理讲解非常清晰，学到了很多。期待更多这样的深度技术文章！',
    postTitle: '深入理解JVM虚拟线程',
    postSlug: 'jvm-virtual-threads',
    status: 'pending',
    createdAt: '2026-01-10T10:30:00Z',
    likes: 12,
  },
  {
    id: 2,
    author: '李四',
    email: 'lisi@example.com',
    content: '请问虚拟线程和协程有什么区别？能否详细说明一下？',
    postTitle: '深入理解JVM虚拟线程',
    postSlug: 'jvm-virtual-threads',
    status: 'pending',
    createdAt: '2026-01-10T11:00:00Z',
    likes: 5,
  },
  {
    id: 3,
    author: '王五',
    email: 'wangwu@example.com',
    content: '感谢分享，这正是我在找的资料！',
    postTitle: 'Spring Boot 3.0 新特性详解',
    postSlug: 'spring-boot-3-features',
    status: 'approved',
    createdAt: '2026-01-09T14:20:00Z',
    likes: 8,
  },
  {
    id: 4,
    author: 'spammer123',
    email: 'spam@spam.com',
    content: '免费领取优惠券，点击链接...',
    postTitle: 'React 19 深度解析',
    postSlug: 'react-19-deep-dive',
    status: 'spam',
    createdAt: '2026-01-09T08:00:00Z',
    likes: 0,
  },
];

export default function CommentsPage() {
  const [selectedStatus, setSelectedStatus] = useState<CommentStatus>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [comments, setComments] = useState<Comment[]>(mockComments);
  const [replyingTo, setReplyingTo] = useState<number | null>(null);
  const [replyContent, setReplyContent] = useState('');

  // Filter comments
  const filteredComments = comments.filter(comment => {
    const matchesStatus = selectedStatus === 'all' || comment.status === selectedStatus;
    const matchesSearch = searchQuery === '' || 
      comment.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
      comment.author.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  // Stats
  const stats = {
    pending: comments.filter(c => c.status === 'pending').length,
    approved: comments.filter(c => c.status === 'approved').length,
    spam: comments.filter(c => c.status === 'spam').length,
    trash: comments.filter(c => c.status === 'trash').length,
  };

  // Actions
  const handleApprove = (id: number) => {
    setComments(prev => prev.map(c => c.id === id ? { ...c, status: 'approved' as const } : c));
    toast.success('评论已通过');
  };

  const handleReject = (id: number) => {
    setComments(prev => prev.map(c => c.id === id ? { ...c, status: 'trash' as const } : c));
    toast.success('评论已拒绝');
  };

  const handleMarkSpam = (id: number) => {
    setComments(prev => prev.map(c => c.id === id ? { ...c, status: 'spam' as const } : c));
    toast.success('已标记为垃圾评论');
  };

  const handleDelete = (id: number) => {
    setComments(prev => prev.filter(c => c.id !== id));
    toast.success('评论已删除');
  };

  const handleReply = (id: number) => {
    if (!replyContent.trim()) return;
    toast.success('回复已发送');
    setReplyingTo(null);
    setReplyContent('');
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
        
        {/* Stats badges */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="px-3 py-1.5 rounded-full text-xs font-medium bg-orange-500/20 text-orange-400">
            待审核: {stats.pending}
          </span>
          <span className="px-3 py-1.5 rounded-full text-xs font-medium bg-red-500/20 text-red-400">
            垃圾: {stats.spam}
          </span>
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
          {(['all', 'pending', 'approved', 'spam', 'trash'] as CommentStatus[]).map((status) => (
            <button
              key={status}
              onClick={() => setSelectedStatus(status)}
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
      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="space-y-3"
      >
        <AnimatePresence mode="popLayout">
          {filteredComments.map((comment) => {
            const StatusIcon = statusConfig[comment.status].icon;
            
            return (
              <motion.div
                key={comment.id}
                variants={item}
                layout
                exit={{ opacity: 0, x: -20 }}
                className="p-4 sm:p-5 rounded-xl bg-white/5 border border-white/10 hover:border-white/20 transition-colors"
              >
                {/* Comment header */}
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                      <User className="w-5 h-5 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-white truncate">{comment.author}</p>
                      <p className="text-xs text-gray-500 truncate">{comment.email}</p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={cn(
                      "px-2 py-1 rounded-full text-xs font-medium flex items-center gap-1",
                      statusConfig[comment.status].bg,
                      statusConfig[comment.status].color
                    )}>
                      <StatusIcon className="w-3 h-3" />
                      <span className="hidden sm:inline">{statusConfig[comment.status].label}</span>
                    </span>
                    <span className="text-xs text-gray-500">{formatDate(comment.createdAt)}</span>
                  </div>
                </div>
                
                {/* Post reference */}
                <div className="mb-3">
                  <a 
                    href={`/posts/${comment.postSlug}`}
                    className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-primary transition-colors"
                  >
                    <MessageSquare className="w-3 h-3" />
                    Re: {comment.postTitle}
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                
                {/* Comment content */}
                <p className="text-gray-300 text-sm leading-relaxed mb-4">
                  {comment.content}
                </p>
                
                {/* Actions */}
                <div className="flex items-center gap-2 flex-wrap">
                  {comment.status === 'pending' && (
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
                  
                  <button
                    onClick={() => setReplyingTo(replyingTo === comment.id ? null : comment.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white text-xs font-medium transition-colors touch-manipulation"
                  >
                    <Reply className="w-3.5 h-3.5" />
                    回复
                  </button>
                  
                  {comment.status !== 'spam' && (
                    <button
                      onClick={() => handleMarkSpam(comment.id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 text-gray-400 hover:bg-orange-500/10 hover:text-orange-400 text-xs font-medium transition-colors touch-manipulation"
                    >
                      <Flag className="w-3.5 h-3.5" />
                      垃圾
                    </button>
                  )}
                  
                  <button
                    onClick={() => handleDelete(comment.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 text-gray-400 hover:bg-red-500/10 hover:text-red-400 text-xs font-medium transition-colors touch-manipulation"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    删除
                  </button>
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
              </motion.div>
            );
          })}
        </AnimatePresence>
        
        {filteredComments.length === 0 && (
          <div className="text-center py-12">
            <MessageSquare className="w-12 h-12 text-gray-600 mx-auto mb-4" />
            <p className="text-gray-500">暂无评论</p>
          </div>
        )}
      </motion.div>
    </div>
  );
}
