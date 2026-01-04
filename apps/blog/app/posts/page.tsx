'use client';

import { useEffect, useState, useCallback } from 'react';
import { LayoutGrid, List, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
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
  contentPreview?: string;
}

interface PaginationInfo {
  pageNum: number;
  pageSize: number;
  total: number;
  pages: number;
}

const PAGE_SIZE = 9; // 3x3 grid

export default function PostsPage() {
  const [featuredPost, setFeaturedPost] = useState<Post | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [pagination, setPagination] = useState<PaginationInfo>({ pageNum: 1, pageSize: PAGE_SIZE, total: 0, pages: 0 });
  const [loading, setLoading] = useState(true);
  const [initialLoading, setInitialLoading] = useState(true);

  // Fetch featured post (first post)
  const fetchFeaturedPost = useCallback(async () => {
    try {
      const res = await fetch('http://localhost:8080/api/v1/public/posts?pageNum=1&pageSize=1');
      if (!res.ok) return;
      const json = await res.json();
      if (json.data?.list?.length > 0) {
        const item = json.data.list[0];
        const post = {
          id: item.id,
          title: item.title,
          slug: item.slug,
          summary: item.summary,
          coverImage: item.coverImage,
          viewCount: item.viewCount,
          publishedAt: new Date(item.publishedAt).toLocaleDateString('zh-CN'),
          category: item.categoryName ? { name: item.categoryName, slug: item.categoryName } : undefined,
          tags: item.tagNames ? item.tagNames.map((name: string) => ({ name, slug: name })) : [],
        };
        // Fetch content for featured post
        try {
          const contentRes = await fetch(`http://localhost:8080/api/v1/public/posts/${item.slug}`);
          if (contentRes.ok) {
            const contentJson = await contentRes.json();
            post.contentPreview = contentJson.data?.content || '';
          }
        } catch (e) {
          console.error('Error fetching content:', e);
        }
        setFeaturedPost(post as Post);
      }
    } catch (error) {
      console.error('Error fetching featured post:', error);
    }
  }, []);

  // Fetch paginated posts (excluding the first one)
  const fetchPosts = useCallback(async (pageNum: number) => {
    try {
      setLoading(true);
      // We skip the first post (featured) by adjusting the offset
      // Actually, we fetch pageSize+1 if on page 1, and skip first
      const res = await fetch(`http://localhost:8080/api/v1/public/posts?pageNum=${pageNum}&pageSize=${PAGE_SIZE + (pageNum === 1 ? 1 : 0)}`);
      if (!res.ok) {
        console.error('Failed to fetch posts');
        return;
      }
      const json = await res.json();
      let list = json.data.list.map((item: any) => ({
        id: item.id,
        title: item.title,
        slug: item.slug,
        summary: item.summary,
        coverImage: item.coverImage,
        viewCount: item.viewCount,
        publishedAt: new Date(item.publishedAt).toLocaleDateString('zh-CN'),
        category: item.categoryName ? { name: item.categoryName, slug: item.categoryName } : undefined,
        tags: item.tagNames ? item.tagNames.map((name: string) => ({ name, slug: name })) : [],
      }));
      
      // On page 1, skip the first post (it's the featured post)
      if (pageNum === 1 && list.length > 0) {
        list = list.slice(1);
      }
      
      setPosts(list);
      // Adjust total to exclude the featured post
      const adjustedTotal = Math.max(0, json.data.total - 1);
      const adjustedPages = Math.ceil(adjustedTotal / PAGE_SIZE);
      setPagination({
        pageNum,
        pageSize: PAGE_SIZE,
        total: adjustedTotal,
        pages: adjustedPages,
      });
    } catch (error) {
      console.error('Error fetching posts:', error);
    } finally {
      setLoading(false);
      setInitialLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFeaturedPost();
    fetchPosts(1);
  }, [fetchFeaturedPost, fetchPosts]);

  const handlePageChange = (page: number) => {
    if (page < 1 || page > pagination.pages) return;
    fetchPosts(page);
    // Scroll to top of posts section
    window.scrollTo({ top: 500, behavior: 'smooth' });
  };

  if (initialLoading) {
    return (
      <div className="min-h-screen bg-background text-white">
        <main className="max-w-7xl mx-auto px-4 pt-24 pb-12">
          {/* 顶部区域骨架 */}
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-12">
            {/* Featured Post 骨架 */}
            <div className="lg:col-span-3 lg:h-[420px] lg:min-h-[420px]">
              <div className="h-full rounded-3xl bg-white/5 border border-white/10 overflow-hidden relative">
                <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
              </div>
            </div>
            
            {/* Author Card 骨架 */}
            <div className="lg:col-span-1 lg:h-[420px] lg:min-h-[420px]">
              <div className="h-full rounded-3xl bg-white/5 border border-white/10 overflow-hidden relative">
                <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
              </div>
            </div>
          </div>

          {/* 最新发布标题骨架 */}
          <div className="flex items-center gap-2 mb-8">
            <div className="w-6 h-6 rounded bg-white/10 overflow-hidden relative">
              <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/20 to-transparent" />
            </div>
            <div className="w-24 h-8 rounded bg-white/10 overflow-hidden relative">
              <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/20 to-transparent" />
            </div>
          </div>

          {/* 文章卡片网格骨架 */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <div 
                key={i} 
                className="rounded-2xl bg-white/5 border border-white/10 overflow-hidden"
                style={{ animationDelay: `${i * 100}ms` }}
              >
                {/* 封面图骨架 */}
                <div className="aspect-video bg-white/10 overflow-hidden relative">
                  <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                </div>
                {/* 内容区骨架 */}
                <div className="p-5 space-y-3">
                  <div className="flex justify-between">
                    <div className="w-16 h-4 bg-white/10 rounded overflow-hidden relative">
                      <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                    </div>
                    <div className="w-20 h-4 bg-white/10 rounded overflow-hidden relative">
                      <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                    </div>
                  </div>
                  <div className="w-full h-6 bg-white/10 rounded overflow-hidden relative">
                    <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                  </div>
                  <div className="w-3/4 h-4 bg-white/10 rounded overflow-hidden relative">
                    <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                  </div>
                  <div className="w-1/2 h-4 bg-white/10 rounded overflow-hidden relative">
                    <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </main>
      </div>
    );
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

        {!featuredPost && posts.length === 0 ? (
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
                {featuredPost && <FeaturedPost post={featuredPost} />}
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
                  <span className="text-sm font-normal text-gray-400 ml-2">
                    （共 {pagination.total} 篇）
                  </span>
                </h2>
              </div>

              {loading ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="w-8 h-8 text-primary animate-spin" />
                </div>
              ) : posts.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {posts.map((post, index) => (
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

              {/* Pagination */}
              {pagination.pages > 1 && (
                <div className="flex items-center justify-center gap-2 mt-10">
                  <button
                    onClick={() => handlePageChange(pagination.pageNum - 1)}
                    disabled={pagination.pageNum <= 1}
                    className={`flex items-center gap-1 px-4 py-2 rounded-lg transition-colors ${
                      pagination.pageNum <= 1
                        ? 'text-gray-600 cursor-not-allowed'
                        : 'bg-white/5 text-gray-300 hover:bg-white/10'
                    }`}
                  >
                    <ChevronLeft className="w-4 h-4" />
                    上一页
                  </button>

                  {Array.from({ length: Math.min(5, pagination.pages) }, (_, i) => {
                    const start = Math.max(1, Math.min(pagination.pageNum - 2, pagination.pages - 4));
                    return start + i;
                  }).filter(p => p <= pagination.pages).map((page) => (
                    <button
                      key={page}
                      onClick={() => handlePageChange(page)}
                      className={`w-10 h-10 rounded-lg transition-colors ${
                        page === pagination.pageNum
                          ? 'bg-primary text-white'
                          : 'bg-white/5 text-gray-400 hover:bg-white/10'
                      }`}
                    >
                      {page}
                    </button>
                  ))}

                  <button
                    onClick={() => handlePageChange(pagination.pageNum + 1)}
                    disabled={pagination.pageNum >= pagination.pages}
                    className={`flex items-center gap-1 px-4 py-2 rounded-lg transition-colors ${
                      pagination.pageNum >= pagination.pages
                        ? 'text-gray-600 cursor-not-allowed'
                        : 'bg-white/5 text-gray-300 hover:bg-white/10'
                    }`}
                  >
                    下一页
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>

          </div>
        )}
      </main>
    </div>
  );
}
