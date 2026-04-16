'use client';

import { useState, useEffect, useRef, useCallback, memo, useId } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Comment, createComment, getComments, SiteSettings } from '../lib/services';
import { Button, Avatar } from '@aetherblog/ui';
import { useIntersectionObserver } from '@aetherblog/hooks';
import { sanitizeUrl } from '../lib/sanitizeUrl';
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

// 递归评论项组件 - Memoized to prevent re-renders when parent state changes
const CommentItem = memo(function CommentItem({ comment, onReply, depth = 0 }: { comment: Comment, onReply: (c: Comment) => void, depth?: number }) {
  const hasChildren = comment.children && comment.children.length > 0;
  // 深度 0 和 1 默认展开，其他折叠
  const [isExpanded, setIsExpanded] = useState(depth < 2);
  const childrenId = useId();

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
          <div className="surface-leaf rounded-xl rounded-tl-none p-4 transition-colors group">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-sm text-[var(--text-primary)] bg-gradient-to-r from-[var(--text-primary)] to-[var(--text-secondary)] bg-clip-text text-transparent">{comment.nickname}</span>
                <span className="text-xs text-[var(--text-muted)] flex items-center gap-1">
                  <span className="w-1 h-1 bg-[var(--text-muted)] rounded-full" />
                  {new Date(comment.createdAt).toLocaleString()}
                </span>

                {comment.website && (
                  <a href={sanitizeUrl(comment.website)} target="_blank" rel="noopener noreferrer" className="text-xs text-[var(--text-secondary)] hover:text-[var(--color-primary)] transition-colors ml-1">
                    <Globe className="w-3 h-3" />
                  </a>
                )}
              </div>

              <Button
                variant="ghost"
                size="sm"
                onClick={() => onReply(comment)}
                className="h-7 px-2 text-[var(--text-muted)] hover:text-[var(--color-primary)] hover:bg-[var(--bg-secondary)] transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                aria-label={`回复 ${comment.nickname} 的评论`}
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
                  type="button"
                  onClick={() => setIsExpanded(true)}
                  aria-expanded={isExpanded}
                  aria-controls={childrenId}
                  className="flex items-center gap-2 text-xs font-medium text-[var(--color-primary-light,var(--color-primary))] hover:text-[var(--color-primary)] transition-colors ml-2 focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]/50 focus-visible:outline-none rounded-sm"
                >
                  <div className="w-4 h-[1px] bg-[var(--border-default)]" />
                  {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                  展开 {comment.children?.length} 条回复
                </button>
              )}

              {/* 可折叠内容 */}
              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    id={childrenId}
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
                        type="button"
                        onClick={() => setIsExpanded(false)}
                        aria-expanded={isExpanded}
                        aria-controls={childrenId}
                        className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] ml-4 pl-4 border-l border-[var(--border-subtle)] h-6 focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]/50 focus-visible:outline-none rounded-sm"
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
});

function CommentSectionBase({ postId, settings }: CommentSectionProps) {
  const formId = useId();
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);

  // 交互状态
  const [isFormExpanded, setIsFormExpanded] = useState(false);
  const [isSectionExpanded, setIsSectionExpanded] = useState(true);

  const [containerRef, isVisible] = useIntersectionObserver<HTMLElement>({
    rootMargin: '200px',
    freezeOnceVisible: true,
  });
  const formRef = useRef<HTMLDivElement>(null);
  const formTriggerRef = useRef<HTMLButtonElement>(null);
  const nicknameInputRef = useRef<HTMLInputElement>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 表单状态
  const [nickname, setNickname] = useState('');
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState('');
  const [content, setContent] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const loadComments = useCallback(async () => {
    try {
      const data = await getComments(postId);
      setComments(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [postId]);

  // 当 postId 变化时，重置加载状态，以便重新懒加载
  useEffect(() => {
    setHasLoaded(false);
    setLoading(true);
    setComments([]);
  }, [postId]);

  useEffect(() => {
    const isEnabled = settings.comment_enabled === true;
    if (isEnabled && isVisible && !hasLoaded) {
      loadComments();
      setHasLoaded(true);
    }
  }, [isVisible, settings.comment_enabled, hasLoaded, loadComments]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    // 字段校验与自动聚焦优化
    if (!nickname.trim()) {
      setError('请输入您的昵称');
      nicknameInputRef.current?.focus();
      return;
    }

    if (!email.trim()) {
      setError('请输入您的邮箱（仅博主可见）');
      emailInputRef.current?.focus();
      return;
    }

    // #189: noValidate disables browser type="email" check; validate manually
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('请输入有效的邮箱地址');
      emailInputRef.current?.focus();
      return;
    }

    if (!content.trim()) {
      setError('请输入评论内容');
      textareaRef.current?.focus();
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

  const handleReply = useCallback((comment: Comment) => {
    setReplyTo(comment);
    setIsFormExpanded(true);
    setTimeout(() => {
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      textareaRef.current?.focus({ preventScroll: true });
    }, 100);
  }, []);

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
    <section ref={containerRef} className="mt-20 max-w-4xl mx-auto">
      {/* 带折叠切换的头部 */}
      <button
        type="button"
        onClick={() => setIsSectionExpanded(!isSectionExpanded)}
        aria-expanded={isSectionExpanded}
        aria-controls="comments-content"
        className="w-full text-left flex items-center justify-between mb-8 pb-4 border-b border-[var(--border-subtle)] cursor-pointer group select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]/50 rounded-lg"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl border border-[var(--border-default)] transition-colors group-hover:border-[var(--border-hover)]" style={{ background: 'linear-gradient(135deg, color-mix(in srgb, var(--color-primary) 15%, transparent), color-mix(in srgb, var(--color-accent) 15%, transparent))' }}>
            <MessageSquare className="w-5 h-5 text-[var(--color-primary-light,var(--color-primary))]" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-[var(--text-primary)] tracking-tight transition-colors">评论交流</h3>
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
                className="surface-leaf w-full p-4 flex items-center gap-4 transition-all group mb-12"
                data-interactive
              >
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[var(--bg-secondary)] to-[var(--bg-card-hover)] border border-[var(--border-subtle)] flex items-center justify-center text-[var(--text-muted)] group-hover:text-[var(--color-primary)] group-hover:border-[var(--border-hover)] transition-colors">
                  <PenLine className="w-5 h-5" />
                </div>
                <div className="flex-1 text-left">
                  <span className="text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors">写下你的想法...</span>
                </div>
                <div className="text-xs text-[var(--text-muted)] bg-[var(--bg-secondary)] px-2 py-1 rounded border border-[var(--border-subtle)] group-hover:border-[var(--border-hover)] transition-colors">
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
                  className="surface-raised p-6 sm:p-8 relative overflow-hidden mb-12"
                >
                  {/* 简化的装饰性渐变 */}
                  <div className="absolute top-0 right-0 w-64 h-64 rounded-full blur-[100px] pointer-events-none -translate-y-1/2 translate-x-1/2" style={{ background: 'color-mix(in srgb, var(--color-primary) 5%, transparent)' }} />

                  <div className="flex items-center justify-between mb-6">
                    <h4 className="text-lg font-medium text-[var(--text-primary)] flex items-center gap-2">
                      {replyTo ? (
                        <>
                          <CornerDownRight className="w-5 h-5 text-[var(--color-primary-light,var(--color-primary))]" />
                          回复 <span className="text-[var(--color-primary-light,var(--color-primary))] font-bold">@{replyTo.nickname}</span>
                        </>
                      ) : '发表评论'}
                    </h4>
                    <button type="button" onClick={closeForm} aria-label={replyTo ? 'Cancel Reply' : 'Cancel Comment'} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]/50 focus-visible:rounded-sm">
                      取消
                    </button>
                  </div>

                  {/* #190: noValidate lets handleSubmit own all validation logic,
                      preventing browser-default messages from preempting custom errors */}
                  <form noValidate onSubmit={handleSubmit} className="relative z-10 space-y-5">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                      <div className="group/input relative">
                        <label htmlFor={`${formId}-nickname`} className="sr-only">昵称</label>
                        <ShieldCheck aria-hidden="true" className="absolute left-3 top-3.5 w-4 h-4 text-[var(--text-muted)] group-focus-within/input:text-[var(--color-primary)] transition-colors z-10" />
                        <input
                          id={`${formId}-nickname`}
                          ref={nicknameInputRef}
                          className="w-full bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-xl py-3 pl-10 pr-4 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--color-primary)]/30 focus:bg-[var(--bg-tertiary)]/30 focus:ring-1 focus:ring-[var(--color-primary)]/30 transition-all"
                          placeholder="昵称 *"
                          value={nickname}
                          onChange={(e) => setNickname(e.target.value)}
                          required
                          aria-invalid={error ? 'true' : undefined}
                          aria-describedby={error ? `${formId}-error` : undefined}
                        />
                      </div>
                      <div className="group/input relative">
                        <label htmlFor={`${formId}-email`} className="sr-only">邮箱</label>
                        <Mail aria-hidden="true" className="absolute left-3 top-3.5 w-4 h-4 text-[var(--text-muted)] group-focus-within/input:text-[var(--color-primary)] transition-colors z-10" />
                        <input
                          id={`${formId}-email`}
                          ref={emailInputRef}
                          className="w-full bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-xl py-3 pl-10 pr-4 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--color-primary)]/30 focus:bg-[var(--bg-tertiary)]/30 focus:ring-1 focus:ring-[var(--color-primary)]/30 transition-all"
                          placeholder="邮箱 (保密) *"
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          required
                          aria-invalid={error ? 'true' : undefined}
                          aria-describedby={error ? `${formId}-error` : undefined}
                        />
                      </div>
                    </div>

                    <div className="group/input relative">
                      <label htmlFor={`${formId}-website`} className="sr-only">网站</label>
                      <Globe aria-hidden="true" className="absolute left-3 top-3.5 w-4 h-4 text-[var(--text-muted)] group-focus-within/input:text-[var(--color-primary)] transition-colors z-10" />
                      <input
                        id={`${formId}-website`}
                        type="url"
                        className="w-full bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-xl py-3 pl-10 pr-4 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--color-primary)]/30 focus:bg-[var(--bg-tertiary)]/30 focus:ring-1 focus:ring-[var(--color-primary)]/30 transition-all"
                        placeholder="网站 (https://...)"
                        value={website}
                        onChange={(e) => setWebsite(e.target.value)}
                      />
                    </div>

                    <div className="relative">
                      <label htmlFor={`${formId}-content`} className="sr-only">评论内容</label>
                      <textarea
                        id={`${formId}-content`}
                        ref={textareaRef}
                        className="w-full bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-xl p-4 pb-8 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--color-primary)]/30 focus:bg-[var(--bg-tertiary)]/30 focus:ring-1 focus:ring-[var(--color-primary)]/30 transition-all min-h-[140px] resize-y leading-relaxed"
                        placeholder="写点什么吧..."
                        value={content}
                        maxLength={500}
                        onChange={(e) => setContent(e.target.value)}
                        required
                        autoFocus
                        aria-invalid={error ? 'true' : undefined}
                        aria-describedby={error ? `${formId}-error` : undefined}
                      />
                      <div
                        className={`absolute bottom-3 right-4 text-xs pointer-events-none select-none transition-colors ${
                          content.length >= 450 ? 'text-red-400' : 'text-[var(--text-muted)]'
                        }`}
                        aria-live="polite"
                        aria-atomic="true"
                      >
                        {content.length}/500
                      </div>
                    </div>

                    <div className="pt-2">
                      <AnimatePresence mode="wait">
                        {error && (
                          <motion.div
                            id={`${formId}-error`}
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
                          <button type="button" onClick={() => setReplyTo(null)} className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]/50 focus-visible:rounded-sm">
                            改为发表新评论
                          </button>
                        )}
                        <button
                          type="submit"
                          disabled={submitting}
                          className="comment-submit-btn text-[var(--text-inverse)] rounded-lg px-6 py-2.5 text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]/50 focus-visible:ring-offset-2"
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
                        </button>
                      </div>
                    </div>
                  </form>
                </motion.div>
              )}
            </AnimatePresence>

            {/* 评论列表 */}
            {loading ? (
              <div className="flex flex-col items-center justify-center py-20 space-y-4">
                <Loader2 className="w-8 h-8 text-[var(--color-primary)] animate-spin" />
                <p className="text-[var(--text-muted)] text-sm">加载评论中...</p>
              </div>
            ) : comments.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center space-y-4 opacity-60 hover:opacity-100 transition-opacity">
                <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[var(--bg-secondary)] to-transparent border border-[var(--border-subtle)] flex items-center justify-center rotate-12 group">
                  <MessageSquare className="w-8 h-8 text-[var(--text-muted)] group-hover:text-[var(--color-primary)] transition-colors" />
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

export default memo(CommentSectionBase);
