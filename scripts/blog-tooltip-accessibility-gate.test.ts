import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const readSource = (relativePath: string) =>
  readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');

const headerSource = readSource('apps/blog/app/components/BlogHeader.tsx');
const floatingThemeSource = readSource('apps/blog/app/components/FloatingThemeToggle.tsx');
const scrollToTopSource = readSource('apps/blog/app/components/ScrollToTop.tsx');
const commentSource = readSource('apps/blog/app/components/CommentSection.tsx');

function adminFallbackSource() {
  const start = headerSource.indexOf('{isAdminLinkAvailable ? (');
  const end = headerSource.indexOf('\n            </nav>', start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return headerSource.slice(start, end);
}

describe('blog icon tooltip accessibility gate', () => {
  it('uses styled tooltips without duplicate native title attributes', () => {
    expect(headerSource).toContain('<Tooltip content="搜索" side="bottom">');
    expect(headerSource).toContain('<Tooltip content="搜索 (Ctrl/⌘ K)" side="bottom">');
    expect(headerSource).toContain('<Tooltip content="管理后台" side="bottom">');
    expect(floatingThemeSource).toContain("<Tooltip content={isDark ? '切换到亮色主题' : '切换到暗色主题'} side=\"left\">");
    expect(scrollToTopSource).toContain('<Tooltip content="返回顶部" side="left">');

    expect(floatingThemeSource).not.toMatch(/\btitle=/);
    expect(scrollToTopSource).not.toMatch(/\btitle=/);
  });

  it('keeps the unavailable admin reason hoverable and keyboard discoverable', () => {
    const fallback = adminFallbackSource();

    expect(fallback).toContain('<Tooltip content={`管理后台未配置：${adminLinkConfig.reason}`} side="bottom">');
    expect(fallback).toContain('type="button"');
    expect(fallback).toContain('aria-disabled="true"');
    expect(fallback).toContain('tabIndex={0}');
    expect(fallback).toContain('aria-label={`管理后台未配置：${adminLinkConfig.reason}`}');
    expect(fallback).not.toMatch(/\sdisabled(?:\s|=|>)/);
    expect(fallback).not.toMatch(/\btitle=/);
  });

  it('uses a transparent focus offset for the fixed mobile theme control', () => {
    expect(floatingThemeSource).toContain('focus-visible:ring-offset-2 focus-visible:ring-offset-transparent');
    expect(floatingThemeSource).not.toContain('focus-visible:ring-offset-[var(--bg-primary)]');
  });

  it('preserves the context-correct comment focus offsets rejected from PR 824', () => {
    expect(commentSource).toMatch(/surface-leaf rounded-xl[\s\S]*?<a[\s\S]*?focus-visible:ring-offset-\[var\(--bg-leaf\)\]/);
    expect(commentSource).toMatch(/<motion\.button[\s\S]*?className="surface-leaf[\s\S]*?focus-visible:ring-offset-\[var\(--bg-void\)\]"/);
  });
});
