import FriendsLoading from './FriendsLoading';

/**
 * /friends 路由级加载态:page.tsx 是 force-dynamic 服务端组件,
 * 导航时由 Next.js 立即渲染本骨架,消除白屏等待(禁 spinner 红线)。
 */
export default function Loading() {
  return <FriendsLoading />;
}
