'use client';

import { useState, useId } from 'react';
import { Lock, Loader2, Eye, EyeOff } from 'lucide-react';
import MarkdownRenderer from '@/app/components/MarkdownRenderer';
import { API_ENDPOINTS } from '@/app/lib/api';

interface ProtectedPostContentProps {
  slug: string;
  title: string;
}

export function ProtectedPostContent({ slug, title }: ProtectedPostContentProps) {
  const id = useId();
  const passwordInputId = `post-password-${id}`;
  const passwordErrorId = `password-error-${id}`;
  const [password, setPassword] = useState('');
  const [content, setContent] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(API_ENDPOINTS.verifyPostPassword(slug), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const json = await res.json();
      if (!res.ok || json.code !== 200 || !json.data?.content) {
        throw new Error(json.message || '密码错误');
      }
      setContent(json.data.content);
    } catch (err: any) {
      setError(err.message || '密码错误');
    } finally {
      setSubmitting(false);
    }
  };

  if (content) {
    return <MarkdownRenderer content={content} className="max-w-none" />;
  }

  return (
    <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-6 md:p-8">
      <div className="mb-5 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Lock className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">这是一篇受密码保护的文章</h2>
          <p className="text-sm text-[var(--text-muted)]">输入密码后查看《{title}》正文。</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor={passwordInputId} className="sr-only">访问密码</label>
          <div className="relative">
            <input
              id={passwordInputId}
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="请输入访问密码"
              className={`w-full rounded-xl border bg-background pl-4 pr-12 py-3 text-[var(--text-primary)] outline-none transition-colors ${error ? 'border-red-500 focus:border-red-500 focus:ring-1 focus:ring-red-500' : 'border-[var(--border-default)] focus:border-primary/50 focus:ring-1 focus:ring-primary/50'}`}
              autoComplete="current-password"
              aria-invalid={!!error}
              aria-describedby={error ? passwordErrorId : undefined}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:rounded-md"
              aria-label={showPassword ? '隐藏密码' : '显示密码'}
            >
              {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          </div>
          {error && <p id={passwordErrorId} role="alert" className="mt-2 text-sm text-red-500 font-medium">{error}</p>}
        </div>
        <button
          type="submit"
          disabled={submitting || !password.trim()}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary transition-shadow"
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {submitting ? '验证中...' : '验证并查看'}
        </button>
      </form>
    </div>
  );
}
