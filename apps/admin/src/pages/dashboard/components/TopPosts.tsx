import { Eye, ArrowUpRight } from 'lucide-react';

interface TopPost {
  id: number;
  title: string;
  views: number;
}

interface TopPostsProps {
  posts: TopPost[];
}

export function TopPosts({ posts }: TopPostsProps) {
  return (
    <div className="p-6 rounded-xl bg-white/5 border border-white/10">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white">热门文章</h3>
        <button className="text-sm text-primary hover:underline">查看全部</button>
      </div>
      <div className="space-y-4">
        {posts.map((post, index) => (
          <div
            key={post.id}
            className="flex items-center gap-4 p-3 rounded-lg hover:bg-white/5 transition-colors cursor-pointer"
          >
            <div
              className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold ${
                index === 0
                  ? 'bg-yellow-500/20 text-yellow-400'
                  : index === 1
                  ? 'bg-gray-400/20 text-gray-300'
                  : index === 2
                  ? 'bg-orange-500/20 text-orange-400'
                  : 'bg-white/10 text-gray-400'
              }`}
            >
              {index + 1}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white truncate">{post.title}</p>
            </div>
            <div className="flex items-center gap-1 text-gray-400">
              <Eye className="w-4 h-4" />
              <span className="text-sm">{post.views}</span>
            </div>
            <ArrowUpRight className="w-4 h-4 text-gray-500" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default TopPosts;
