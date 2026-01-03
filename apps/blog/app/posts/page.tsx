import { LayoutGrid, List } from 'lucide-react';
import Link from 'next/link';
import ArticleCard from '../components/ArticleCard';
import FeaturedPost from '../components/FeaturedPost';
import AuthorProfileCard from '../components/AuthorProfileCard';

interface Post {
  id: number;
  title: string;
  slug: string;
  summary: string;
  coverImage?: string;
  publishedAt: string;
  viewCount?: number;
  category?: { name: string; slug: string };
  tags?: { name: string; slug: string }[];
}

// 实际从API获取数据
async function getPosts(): Promise<Post[]> {
  try {
    const res = await fetch('http://localhost:8080/api/v1/public/posts?pageSize=10', { 
      next: { revalidate: 60 } // 缓存60秒，期间使用缓存数据
    });
    if (!res.ok) {
        console.error('Failed to fetch posts:', res.status, res.statusText);
        return [];
    }
    const json = await res.json();
    return json.data.list.map((item: any) => ({
      id: item.id,
      title: item.title,
      slug: item.slug,
      summary: item.summary,
      coverImage: item.coverImage,
      viewCount: item.viewCount,
      publishedAt: new Date(item.publishedAt).toLocaleDateString('zh-CN'),
      category: item.categoryName ? { name: item.categoryName, slug: item.categoryName } : undefined,
      tags: item.tagNames ? item.tagNames.map((name: string) => ({ name, slug: name })) : []
    }));
  } catch (error) {
    console.error('Error fetching posts:', error);
    return [];
  }
}

async function getFeaturedPostContent(slug: string): Promise<string> {
    try {
        const res = await fetch(`http://localhost:8080/api/v1/public/posts/${slug}`, { 
          next: { revalidate: 60 } // 缓存60秒
        });
        if (!res.ok) return '';
        const json = await res.json();
        return json.data?.content || '';
    } catch (e) {
        console.error('Error fetching featured post content:', e);
        return '';
    }
}

export default async function PostsPage() {
  const posts = await getPosts();
  let latestPost: any = posts.length > 0 ? posts[0] : null;
  const remainingPosts = posts.length > 1 ? posts.slice(1) : [];

  // Fetch content for the featured post if it exists
  if (latestPost) {
      const content = await getFeaturedPostContent(latestPost.slug);
      latestPost = { ...latestPost, contentPreview: content };
  }

  return (
    <div className="min-h-screen bg-background text-white selection:bg-primary/30">
      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 pt-24 pb-12">
        {/* Background Ambient Light */}
        <div className="fixed top-0 left-0 right-0 h-[500px] pointer-events-none -z-10">
            <div className="absolute top-[-100px] left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-primary/10 rounded-full blur-[120px] opacity-30" />
            <div className="absolute top-[-100px] right-0 w-[600px] h-[400px] bg-purple-500/10 rounded-full blur-[100px] opacity-20" />
        </div>

        {posts.length === 0 ? (
          <div className="text-center py-32 bg-white/5 rounded-3xl border border-white/5 backdrop-blur-sm">
            <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-6">
                <List className="w-10 h-10 text-gray-500" />
            </div>
            <p className="text-gray-300 text-xl font-medium">暂无文章</p>
            <p className="text-gray-500 text-sm mt-2">精彩内容即将呈现...</p>
          </div>
        ) : (
          <div className="space-y-12">
            
            {/* Top Section: Featured + Sidebar */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                {/* Left: Featured Post (75%) */}
                <div className="lg:col-span-3 lg:h-[420px] lg:min-h-[420px]">
                     {latestPost && <FeaturedPost post={latestPost} />}
                </div>

                {/* Right: Author Profile (25%) */}
                <div className="lg:col-span-1 lg:h-[420px] lg:min-h-[420px]">
                    <AuthorProfileCard className="h-full" />
                </div>
            </div>

            {/* Bottom Section: Remaining Posts Grid */}
            <div>
                <div className="flex items-center justify-between mb-8">
                     <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                        <LayoutGrid className="w-6 h-6 text-primary" />
                        最新发布
                     </h2>
                    <div className="flex gap-2">
                         {/* View Toggles (Visual only for now) */}
                    </div>
                </div>

                 {remainingPosts.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {remainingPosts.map((post, index) => (
                        <ArticleCard
                            key={post.id}
                            title={post.title}
                            slug={post.slug}
                            summary={post.summary}
                            coverImage={post.coverImage}
                            category={post.category}
                            tags={post.tags}
                            publishedAt={post.publishedAt}
                            viewCount={post.viewCount}
                            index={index}
                        />
                        ))}
                    </div>
                 ) : (
                    <div className="text-center py-20 border border-dashed border-white/10 rounded-2xl">
                         <p className="text-gray-500">没有更多文章了</p>
                    </div>
                 )}
            </div>

          </div>
        )}
      </main>
    </div>
  );
}
