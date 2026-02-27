'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Home, ArrowLeft, FileQuestion } from 'lucide-react';

export default function NotFound() {
  const router = useRouter();

  return (
    <div className="min-h-[80vh] flex flex-col items-center justify-center p-4 text-center">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="flex flex-col items-center"
      >
        <div className="relative inline-block mb-6">
          <h1 className="text-9xl font-black text-transparent bg-clip-text bg-gradient-to-r from-primary/20 to-purple-600/20 select-none tracking-tighter">
            404
          </h1>
          <div className="absolute inset-0 flex items-center justify-center">
            <FileQuestion className="w-24 h-24 text-primary opacity-80" />
          </div>
        </div>

        <h2 className="text-3xl font-bold text-foreground mb-3">
          页面未找到
        </h2>

        <p className="text-foreground-secondary max-w-md mx-auto mb-10 text-lg leading-relaxed">
          抱歉，您访问的页面可能已被移除、重命名或暂时不可用。
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center w-full max-w-sm mx-auto">
          <button
            onClick={() => router.back()}
            className="px-6 py-3 rounded-xl border border-border text-foreground-secondary bg-background-card hover:bg-[var(--bg-card-hover)] hover:text-foreground hover:border-border-hover transition-all flex items-center justify-center gap-2 font-medium group"
          >
            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
            返回上一页
          </button>

          <Link
            href="/"
            className="px-6 py-3 rounded-xl bg-primary text-white hover:bg-primary-hover transition-all shadow-lg shadow-indigo-500/20 hover:shadow-indigo-500/30 flex items-center justify-center gap-2 font-medium hover:-translate-y-0.5"
          >
            <Home className="w-4 h-4" />
            回到首页
          </Link>
        </div>

        <div className="mt-12 text-sm text-foreground-muted opacity-60 hover:opacity-100 transition-opacity">
            Tips: 您也可以尝试按 <kbd className="px-1.5 py-0.5 rounded bg-background-secondary border border-[var(--border-subtle)] font-mono text-xs mx-1">Cmd/Ctrl + K</kbd> 进行全站搜索
        </div>
      </motion.div>
    </div>
  );
}
