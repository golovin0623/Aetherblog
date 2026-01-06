'use client';

import { useState } from 'react';
import { LayoutGrid, List, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import ArticleCard from '../components/ArticleCard';
import FeaturedPost from '../components/FeaturedPost';
import AuthorProfileCard from '../components/AuthorProfileCard';
import PostsLoading from './PostsLoading';
import { API_ENDPOINTS } from '../lib/api';

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

const PAGE_SIZE = 6;

export default function PostsPage() {
  const [currentPage, setCurrentPage] = useState(1);

  // 1. Fetch Featured Post (Always fetch, it's small and cached)
  const { 
    data: featuredPost,
    isLoading: isFeaturedLoading 
  } = useQuery({
    queryKey: ['featuredPost'],
    queryFn: async () => {
      const res = await fetch(`${API_ENDPOINTS.posts}?pageNum=1&pageSize=1`);
      if (!res.ok) throw new Error('Network response was not ok');
      const json = await res.json();
      if (!json.data?.list?.length) return null;
      
      const item = json.data.list[0];
      const post: Post = {
        id: item.id,
        title: item.title,
        slug: item.slug,
        summary: item.summary,
        coverImage: item.coverImage,
        viewCount: item.viewCount,
        publishedAt: item.publishedAt 
          ? new Date(item.publishedAt).toLocaleDateString('zh-CN') 
          : '暂无日期',
        category: item.categoryName ? { name: item.categoryName, slug: item.categoryName } : undefined,
        tags: item.tagNames ? item.tagNames.map((name: string) => ({ name, slug: name })) : [],
      };

      // Fetch content preview
      try {
        const contentRes = await fetch(API_ENDPOINTS.postBySlug(item.slug));
        if (contentRes.ok) {
          const contentJson = await contentRes.json();
          post.contentPreview = contentJson.data?.content || '';
        }
      } catch (e) {
        console.warn('Failed to fetch content preview', e);
      }
      return post;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes cache
  });

  // 2. Fetch Paginated Posts
  const { 
    data: postsData,
    isLoading: isPostsLoading,
    isPlaceholderData 
  } = useQuery({
    queryKey: ['posts', currentPage],
    queryFn: async () => {
      // Calculate effective page size/offset logic
      // Original logic: page 1 fetches 10 items (skipped 1), others fetch 9
      const effectivePageSize = PAGE_SIZE + (currentPage === 1 ? 1 : 0);
      const res = await fetch(`${API_ENDPOINTS.posts}?pageNum=${currentPage}&pageSize=${effectivePageSize}`);
      if (!res.ok) throw new Error('Network response was not ok');
      const json = await res.json();
      
      let list = json.data.list.map((item: any) => ({
        id: item.id,
        title: item.title,
        slug: item.slug,
        summary: item.summary,
        coverImage: item.coverImage,
        viewCount: item.viewCount,
        publishedAt: item.publishedAt 
          ? new Date(item.publishedAt).toLocaleDateString('zh-CN') 
          : '暂无日期',
        category: item.categoryName ? { name: item.categoryName, slug: item.categoryName } : undefined,
        tags: item.tagNames ? item.tagNames.map((name: string) => ({ name, slug: name })) : [],
      }));

      // If page 1, remove the first item (featured post)
      if (currentPage === 1 && list.length > 0) {
        list = list.slice(1);
      }

      const total = Math.max(0, json.data.total - 1);
      
      return {
        list: list as Post[],
        total: total,
        pages: Math.ceil(total / PAGE_SIZE)
      };
    },
    placeholderData: (previousData) => previousData, // Keep previous data while fetching new page
    staleTime: 5 * 60 * 1000, // 5 minutes cache
  });

  const handlePageChange = (page: number) => {
    if (!postsData || page < 1 || page > postsData.pages) return;
    setCurrentPage(page);
    window.scrollTo({ top: 500, behavior: 'smooth' });
  };

  // Initial loading state (only for first load)
  if (isFeaturedLoading || (isPostsLoading && !postsData)) {
    return <PostsLoading />;
  }

  const posts = postsData?.list || [];
  const total = postsData?.total || 0;
  const pages = postsData?.pages || 0;

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
                    （共 {total} 篇）
                  </span>
                </h2>
              </div>

              {/* Grid or Pagination Loading Spinner */}
              {isPostsLoading && isPlaceholderData ? (
                 <div className="flex items-center justify-center py-20 opacity-50">
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
                  <p className="text-gray-500">
                    {total === 0 ? '没有更多文章了' : '加载中...'}
                  </p>
                </div>
              )}

              {/* Pagination */}
              {pages > 1 && (
                <div className="flex items-center justify-center gap-2 mt-10">
                  <button
                    onClick={() => handlePageChange(currentPage - 1)}
                    disabled={currentPage <= 1 || isPlaceholderData}
                    className={`flex items-center gap-1 px-4 py-2 rounded-lg transition-colors ${
                      currentPage <= 1
                        ? 'text-gray-600 cursor-not-allowed'
                        : 'bg-white/5 text-gray-300 hover:bg-white/10'
                    }`}
                  >
                    <ChevronLeft className="w-4 h-4" />
                    上一页
                  </button>

                  {Array.from({ length: Math.min(5, pages) }, (_, i) => {
                    const start = Math.max(1, Math.min(currentPage - 2, pages - 4));
                    return start + i;
                  }).filter(p => p <= pages).map((page) => (
                    <button
                      key={page}
                      onClick={() => handlePageChange(page)}
                      className={`w-10 h-10 rounded-lg transition-colors ${
                        page === currentPage
                          ? 'bg-primary text-white'
                          : 'bg-white/5 text-gray-400 hover:bg-white/10'
                      }`}
                    >
                      {page}
                    </button>
                  ))}

                  <button
                    onClick={() => handlePageChange(currentPage + 1)}
                    disabled={currentPage >= pages || isPlaceholderData}
                    className={`flex items-center gap-1 px-4 py-2 rounded-lg transition-colors ${
                      currentPage >= pages
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
