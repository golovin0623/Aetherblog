/**
 * 文章详情页的布局边界
 * 创建独立的 Suspense 边界，防止显示父级 /posts 的 loading.tsx
 */
export default function ArticleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
