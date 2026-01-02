import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center">
      <h1 className="text-8xl font-bold text-white mb-4">404</h1>
      <p className="text-xl text-gray-400 mb-8">页面不存在</p>
      <Link
        href="/"
        className="px-6 py-3 rounded-lg bg-primary text-white font-medium hover:bg-primary/90 transition-colors"
      >
        返回首页
      </Link>
    </div>
  );
}
