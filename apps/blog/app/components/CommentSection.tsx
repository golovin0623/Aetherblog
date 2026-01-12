'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Comment, createComment, getComments, SiteSettings } from '../lib/services';
import { Button, Input, Avatar } from '@aetherblog/ui';
import { MessageSquare, Send, Reply, Loader2 } from 'lucide-react';

interface CommentSectionProps {
  postId: number;
  settings: SiteSettings;
}

export default function CommentSection({ postId, settings }: CommentSectionProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [replyTo, setReplyTo] = useState<Comment | null>(null);

  // Form state
  const [nickname, setNickname] = useState('');
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState('');
  const [content, setContent] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    // Check if comment_enabled is true
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
    setSubmitting(true);

    try {
      await createComment(postId, {
        nickname,
        email,
        website,
        content,
        parentId: replyTo?.id
      });

      setSuccess('评论提交成功，等待审核中...');
      setContent('');
      setReplyTo(null);
      // Don't reload comments immediately as it requires approval
    } catch (err: any) {
      setError(err.message || '提交失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  const isEnabled = settings.comment_enabled === true;
  if (!isEnabled) return null;

  return (
    <section className="mt-16 pt-10 border-t border-white/10">
      <h3 className="text-2xl font-semibold mb-8 flex items-center gap-2">
        <MessageSquare className="w-6 h-6 text-indigo-400" />
        评论 <span className="text-slate-500 text-lg font-normal">({comments.length})</span>
      </h3>

      {/* Comment Form */}
      <div className="bg-white/5 rounded-2xl p-6 mb-10 border border-white/10">
        <h4 className="text-lg font-medium mb-4 text-slate-200">
          {replyTo ? (
            <div className="flex items-center justify-between">
              <span>回复 @{replyTo.nickname}</span>
              <button
                onClick={() => setReplyTo(null)}
                className="text-sm text-slate-400 hover:text-white"
              >
                取消回复
              </button>
            </div>
          ) : '发表评论'}
        </h4>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              placeholder="昵称 *"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              required
            />
            <Input
              placeholder="邮箱 (保密) *"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <Input
            placeholder="网站 (可选)"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
          <textarea
            className="w-full bg-black/20 border border-white/10 rounded-lg p-3 text-slate-200 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-colors min-h-[120px] resize-y"
            placeholder="写下你的想法..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            required
          />

          {error && <p className="text-red-400 text-sm">{error}</p>}
          {success && <p className="text-green-400 text-sm">{success}</p>}

          <div className="flex justify-end">
            <Button type="submit" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  提交中...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4 mr-2" />
                  提交评论
                </>
              )}
            </Button>
          </div>
        </form>
      </div>

      {/* Comments List */}
      {loading ? (
        <div className="text-center py-10 text-slate-500">加载评论中...</div>
      ) : comments.length === 0 ? (
        <div className="text-center py-10 text-slate-500 bg-white/5 rounded-2xl border border-white/5 border-dashed">
          暂无评论，快来抢沙发吧！
        </div>
      ) : (
        <div className="space-y-6">
          {comments.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              onReply={(c) => {
                setReplyTo(c);
                const form = document.querySelector('form');
                if (form) {
                  form.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function CommentItem({ comment, onReply }: { comment: Comment, onReply: (c: Comment) => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="group"
    >
      <div className="flex gap-4">
        <Avatar src={comment.avatar} alt={comment.nickname} fallback={comment.nickname} />
        <div className="flex-1">
          <div className="bg-white/5 rounded-xl p-4 border border-white/5">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="font-medium text-slate-200">{comment.nickname}</span>
                <span className="text-xs text-slate-500">{new Date(comment.createdAt).toLocaleDateString()}</span>
              </div>
              <button
                onClick={() => onReply(comment)}
                className="text-slate-500 hover:text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Reply className="w-4 h-4" />
              </button>
            </div>
            <p className="text-slate-300 text-sm leading-relaxed whitespace-pre-wrap">{comment.content}</p>
          </div>

          {/* Nested comments would go here if we had recursive structure in API response */}
          {comment.children && comment.children.length > 0 && (
            <div className="mt-4 ml-4 pl-4 border-l-2 border-white/10 space-y-4">
              {comment.children.map(child => (
                <CommentItem key={child.id} comment={child} onReply={onReply} />
              ))}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
