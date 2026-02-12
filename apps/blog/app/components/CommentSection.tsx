'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Comment, createComment, getComments, SiteSettings } from '../lib/services';
import { Button, Avatar } from '@aetherblog/ui';
import { 
  MessageSquare, 
  Send, 
  Reply, 
  Loader2, 
  ChevronDown, 
  ChevronRight,
  CornerDownRight,
  ShieldCheck,
  Globe,
  Mail,
  PenLine,
  ChevronUp,
  AlertCircle,
  CheckCircle2
} from 'lucide-react';

interface CommentSectionProps {
  postId: number;
  settings: SiteSettings;
}

export default function CommentSection({ postId, settings }: CommentSectionProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  
  // 交互状态
  const [isFormExpanded, setIsFormExpanded] = useState(false);
  const [isSectionExpanded, setIsSectionExpanded] = useState(true);

  const formRef = useRef<HTMLDivElement>(null);
  const formTriggerRef = useRef<HTMLButtonElement>(null);

  // 表单状态
  const [nickname, setNickname] = useState('');
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState('');
  const [content, setContent] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    // 检查 comment_enabled 是否为 true
    const isEnabled = settings.comment_enabled === true;
    if (isEnabled) {
      loadComments();
    }
  }, [postId, settings.comment_enabled]);

  const loadComments = async () => {
    try {
      const data = await getComments(postId);
      setComments(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    
    if (!nickname.trim() || !email.trim() || !content.trim()) {
      setError('请完善必填信息 (*)');
      return;
    }

    setSubmitting(true);

    try {
      await createComment(postId, {
        nickname,
        email,
        website,
        content,
        parentId: replyTo?.id
      });

      setSuccess('评论提交成功，审核通过后显示');
      setContent('');
      setReplyTo(null);
      
      // 延迟关闭表单以显示成功消息
      setTimeout(() => {
        setSuccess('');
        setIsFormExpanded(false);
      }, 2000);

    } catch (err: any) {
      setError(err.message || '提交失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReply = (comment: Comment) => {
    setReplyTo(comment);
    setIsFormExpanded(true);
    setTimeout(() => {
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // 如果检查 DOM，聚焦 textarea 的逻辑可以放在这里
    }, 100);
  };

  // 关闭表单处理器
  const closeForm = () => {
    setReplyTo(null);
    setIsFormExpanded(false);
    setError('');
    setSuccess('');
  };

  const isEnabled = settings.comment_enabled === true;
  if (!isEnabled) return null;

  return (
    <section className="mt-20 max-w-4xl mx-auto">
      {/* 带折叠切换的头部 */}
      <button
        type="button"
        onClick={() => setIsSectionExpanded(!isSectionExpanded)}
        aria-expanded={isSectionExpanded}
        aria-controls="comments-content"
        className="w-full text-left flex items-center justify-between mb-8 pb-4 border-b border-[var(--border-subtle)] cursor-pointer group select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 rounded-lg"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-br from-indigo-500/20 to-purple-500/20 rounded-xl border border-indigo-500/20 group-hover:bg-indigo-500/30 transition-colors">
            <MessageSquare className="w-5 h-5 text-indigo-400" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-[var(--text-primary)] tracking-tight group-hover:text-indigo-300 transition-colors">评论交流</h3>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">Comments ({comments.length})</p>
          </div>
        </div>
        <div className="p-2 rounded-full hover:bg-[var(--bg-card-hover)] transition-colors text-[var(--text-muted)]">
{isSectionExpanded ? <ChevronUp aria-hidden="true" className="w-5 h-5" /> : <ChevronDown aria-hidden="true" className="w-5 h-5" />}
        </div>
      </button>

      <AnimatePresence>
        {isSectionExpanded && (
          <motion.div
            id="comments-content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            {/* 折叠表单触发器 */}
            {!isFormExpanded && (
              <motion.button
                ref={formTriggerRef}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                onClick={() => setIsFormExpanded(true)}
                className="w-full bg-[var(--bg-card)] hover:bg-[var(--bg-card-hover)] border border-[var(--border-subtle)] hover:border-indigo-500/30 rounded-2xl p-4 flex items-center gap-4 transition-all group mb-12 shadow-lg hover:shadow-indigo-500/10"
              >
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[var(--bg-secondary)] to-[var(--bg-card-hover)] border border-[var(--border-subtle)] flex items-center justify-center text-[var(--text-muted)] group-hover:text-indigo-400 group-hover:border-indigo-500/30 transition-colors">
                  <PenLine className="w-5 h-5" />
                </div>
                <div className="flex-1 text-left">
                  <span className="text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors">写下你的想法...</span>
                </div>
                <div className="text-xs text-[var(--text-muted)] bg-[var(--bg-secondary)] px-2 py-1 rounded border border-[var(--border-subtle)] group-hover:border-indigo-500/20 transition-colors">
                  点击发表
                </div>
              </motion.button>
            )}

            {/* 展开的评论表单 */}
            <AnimatePresence>
              {isFormExpanded && (
                <motion.div
                  ref={formRef}
                  initial={{ opacity: 0, height: 0, scale: 0.98 }}
                  animate={{ opacity: 1, height: 'auto', scale: 1 }}
                  exit={{ opacity: 0, height: 0, scale: 0.98 }}
                  className="bg-[var(--bg-card)] rounded-2xl p-6 sm:p-8 relative overflow-hidden border border-[var(--border-default)] shadow-2xl shadow-indigo-500/5 mb-12"
                >
                    {/* 简化的装饰性渐变 */}
                    <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/5 rounded-full blur-[100px] pointer-events-none -translate-y-1/2 translate-x-1/2" />
                    
                    <div className="flex items-center justify-between mb-6">
                      <h4 className="text-lg font-medium text-[var(--text-primary)] flex items-center gap-2">
                         {replyTo ? (
                           <>
                             <CornerDownRight className="w-5 h-5 text-indigo-400" />
                             回复 <span className="text-indigo-400 font-bold">@{replyTo.nickname}</span>
                           </>
                         ) : '发表评论'}
                      </h4>
                      <button onClick={closeForm} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors text-sm">
                        取消
                      </button>
                    </div>

                    <form onSubmit={handleSubmit} className="relative z-10 space-y-5">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                        <div className="group/input relative">
                          <ShieldCheck aria-hidden="true" className="absolute left-3 top-3.5 w-4 h-4 text-[var(--text-muted)] group-focus-within/input:text-indigo-400 transition-colors z-10" />
                          <input
                            aria-label="昵称"
                            className="w-full bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-xl py-3 pl-10 pr-4 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-indigo-500/50 focus:bg-indigo-500/5 focus:ring-1 focus:ring-indigo-500/50 transition-all"
                            placeholder="昵称 *"
                            value={nickname}
                            onChange={(e) => setNickname(e.target.value)}
                            required
                          />
                        </div>
                        <div className="group/input relative">
                          <Mail aria-hidden="true" className="absolute left-3 top-3.5 w-4 h-4 text-[var(--text-muted)] group-focus-within/input:text-indigo-400 transition-colors z-10" />
                          <input
                            aria-label="邮箱"
                            className="w-full bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-xl py-3 pl-10 pr-4 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-indigo-500/50 focus:bg-indigo-500/5 focus:ring-1 focus:ring-indigo-500/50 transition-all"
                            placeholder="邮箱 (保密) *"
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                          />
                        </div>
                      </div>
                      
                      <div className="group/input relative">
                        <Globe aria-hidden="true" className="absolute left-3 top-3.5 w-4 h-4 text-[var(--text-muted)] group-focus-within/input:text-indigo-400 transition-colors z-10" />
                        <input
type="url"
                          aria-label="网站"
                          className="w-full bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-xl py-3 pl-10 pr-4 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-indigo-500/50 focus:bg-indigo-500/5 focus:ring-1 focus:ring-indigo-500/50 transition-all"
                          placeholder="网站 (https://...)"
                          value={website}
                          onChange={(e) => setWebsite(e.target.value)}
                        />
                      </div>

                      <div className="relative">
                        <textarea
                          aria-label="评论内容"
                          className="w-full bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-xl p-4 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-indigo-500/50 focus:bg-indigo-500/5 focus:ring-1 focus:ring-indigo-500/50 transition-all min-h-[140px] resize-y leading-relaxed"
                          placeholder="写点什么吧..."
                          value={content}
                          onChange={(e) => setContent(e.target.value)}
                          required
                          autoFocus
                        />
                      </div>

                      <div className="pt-2">
                        <AnimatePresence mode="wait">
                          {error && (
                            <motion.div
                              initial={{ opacity: 0, y: -10, height: 0 }}
                              animate={{ opacity: 1, y: 0, height: 'auto' }}
                              exit={{ opacity: 0, y: -10, height: 0 }}
                              className="flex items-center gap-2 text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2 text-xs mb-3"
                              role="alert"
                            >
                              <AlertCircle className="w-4 h-4 flex-shrink-0" />
                              <span>{error}</span>
                            </motion.div>
                          )}
                          {success && (
                            <motion.div
                              initial={{ opacity: 0, y: -10, height: 0 }}
                              animate={{ opacity: 1, y: 0, height: 'auto' }}
                              exit={{ opacity: 0, y: -10, height: 0 }}
                              className="flex items-center gap-2 text-green-400 bg-green-400/10 border border-green-400/20 rounded-lg px-3 py-2 text-xs mb-3"
                              role="alert"
                            >
                              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                              <span>{success}</span>
                            </motion.div>
                          )}
                        </AnimatePresence>

                        <div className="flex items-center justify-end gap-3">
                           {replyTo && (
                             <button type="button" onClick={() => setReplyTo(null)} className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
                               改为发表新评论
                             </button>
                           )}
                           <Button 
                            type="submit" 
                            disabled={submitting}
                            className="bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg px-6 py-2.5 text-sm font-medium transition-all shadow-lg shadow-indigo-600/20 hover:shadow-indigo-600/40 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                          >
                            {submitting ? (
                              <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                发送中
                              </>
                            ) : (
                              <>
                                <Send className="w-4 h-4" />
                                发布
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                    </form>
                </motion.div>
              )}
            </AnimatePresence>

            {/* 评论列表 */}
            {loading ? (
              <div className="flex flex-col items-center justify-center py-20 space-y-4">
                <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
                <p className="text-[var(--text-muted)] text-sm">加载评论中...</p>
              </div>
            ) : comments.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center space-y-4 opacity-60 hover:opacity-100 transition-opacity">
                 <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[var(--bg-secondary)] to-transparent border border-[var(--border-subtle)] flex items-center justify-center rotate-12 group">
                   <MessageSquare className="w-8 h-8 text-[var(--text-muted)] group-hover:text-indigo-400 transition-colors" />
                 </div>
                 <div>
                   <p className="text-[var(--text-secondary)] font-medium">还没有人评论</p>
                   <p className="text-[var(--text-muted)] text-sm mt-1">来做第一个发言的人吧</p>
                 </div>
              </div>
            ) : (
              <div className="space-y-8">
                {comments.map((comment) => (
                  <CommentItem
                    key={comment.id}
                    comment={comment}
                    onReply={handleReply}
                  />
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

// 递归评论项组件
function CommentItem({ comment, onReply, depth = 0 }: { comment: Comment, onReply: (c: Comment) => void, depth?: number }) {
  const hasChildren = comment.children && comment.children.length > 0;
  // 深度 0 和 1 默认展开，其他折叠
  const [isExpanded, setIsExpanded] = useState(depth < 2);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="relative"
    >
      <div className="flex gap-4">
        <div className="flex-shrink-0 relative">
          <Avatar 
            src={comment.avatar} 
            alt={comment.nickname} 
            fallback={comment.nickname.slice(0, 1).toUpperCase()} 
            className="w-10 h-10 border-2 border-[#1a1d24] ring-2 ring-white/5 shadow-lg"
          />
          {/* 子评论连接线 */}
          {hasChildren && isExpanded && (
            <div className="absolute top-12 left-1/2 -translate-x-1/2 w-[2px] h-[calc(100%-48px)] bg-gradient-to-b from-white/10 to-transparent" />
          )}
        </div>

        <div className="flex-1 pb-2">
          {/* 评论卡片 */}
          <div className="bg-[var(--bg-card)]/80 backdrop-blur-sm border border-[var(--border-subtle)] rounded-xl rounded-tl-none p-4 hover:border-[var(--border-hover)] transition-colors group">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-sm text-[var(--text-primary)] bg-gradient-to-r from-[var(--text-primary)] to-[var(--text-secondary)] bg-clip-text text-transparent">{comment.nickname}</span>
                <span className="text-xs text-[var(--text-muted)] flex items-center gap-1">
                  <span className="w-1 h-1 bg-[var(--text-muted)] rounded-full" />
                  {new Date(comment.createdAt).toLocaleString()}
                </span>
                
                {comment.website && (
                  <a href={comment.website} target="_blank" rel="noreferrer" className="text-xs text-[var(--text-secondary)] hover:text-indigo-400 transition-colors ml-1">
                    <Globe className="w-3 h-3" />
                  </a>
                )}
              </div>
              
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => onReply(comment)}
                className="h-7 px-2 text-[var(--text-muted)] hover:text-indigo-400 hover:bg-indigo-500/10 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
              >
                <Reply className="w-3.5 h-3.5 mr-1" />
                <span className="text-xs">回复</span>
              </Button>
            </div>
            
            <div className="text-[var(--text-secondary)] text-sm leading-7 whitespace-pre-wrap">
              {comment.content}
            </div>
          </div>

          {/* 子评论 / 展开切换 */}
          {hasChildren && (
            <div className="mt-3">
              {/* 切换按钮 */}
              {!isExpanded && (
                <button 
                  onClick={() => setIsExpanded(true)}
                  className="flex items-center gap-2 text-xs font-medium text-indigo-400 hover:text-indigo-300 transition-colors ml-2"
                >
                  <div className="w-4 h-[1px] bg-indigo-500/30" />
                  {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                  展开 {comment.children?.length} 条回复
                </button>
              )}

              {/* 可折叠内容 */}
              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden space-y-4 pt-3"
                  >
                    {comment.children!.map(child => (
                      <CommentItem 
                        key={child.id} 
                        comment={child} 
                        onReply={onReply} 
                        depth={depth + 1}
                      />
                    ))}
                    
                    {/* 长评论折叠按钮 */}
                    {comment.children!.length > 2 && (
                      <button 
                        onClick={() => setIsExpanded(false)}
                        className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] ml-4 pl-4 border-l border-[var(--border-subtle)] h-6"
                      >
                       <div className="w-2 h-[1px] bg-[var(--border-default)]" />
                        收起回复
                      </button>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
