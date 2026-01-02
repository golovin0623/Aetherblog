import Link from 'next/link';

interface FriendLink {
  id: number;
  name: string;
  url: string;
  logo?: string;
  description?: string;
}

async function getFriendLinks(): Promise<FriendLink[]> {
  return [];
}

export default async function FriendsPage() {
  const friends = await getFriendLinks();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-white/10 py-4">
        <div className="max-w-6xl mx-auto px-4 flex items-center justify-between">
          <Link href="/" className="text-xl font-bold text-white">
            AetherBlog
          </Link>
          <nav className="flex gap-6">
            <Link href="/posts" className="text-gray-400 hover:text-white">文章</Link>
            <Link href="/friends" className="text-primary">友链</Link>
            <Link href="/about" className="text-gray-400 hover:text-white">关于</Link>
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-12">
        <h1 className="text-3xl font-bold text-white mb-8">友情链接</h1>
        
        {friends.length === 0 ? (
          <p className="text-gray-400 text-center py-20">暂无友链</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {friends.map((friend) => (
              <a
                key={friend.id}
                href={friend.url}
                target="_blank"
                rel="noopener noreferrer"
                className="p-6 rounded-xl bg-white/5 border border-white/10 hover:border-primary/50 transition-all group"
              >
                <div className="flex items-center gap-4">
                  {friend.logo && (
                    <img
                      src={friend.logo}
                      alt={friend.name}
                      className="w-12 h-12 rounded-full object-cover"
                    />
                  )}
                  <div>
                    <h3 className="text-white font-medium group-hover:text-primary">
                      {friend.name}
                    </h3>
                    {friend.description && (
                      <p className="text-sm text-gray-400 line-clamp-1">
                        {friend.description}
                      </p>
                    )}
                  </div>
                </div>
              </a>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
