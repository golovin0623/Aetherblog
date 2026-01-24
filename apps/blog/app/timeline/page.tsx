'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import TimelineTree from '../components/TimelineTree';
import TimelineLoading from './loading';
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
}

// 客户端辅助函数：按日期分组文章
function groupPostsByDate(posts: Post[]): any[] {
  const groups: { [year: number]: { [month: number]: any[] } } = {};

  posts.forEach(post => {
    const date = new Date(post.publishedAt);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;

    if (!groups[year]) groups[year] = {};
    if (!groups[year][month]) groups[year][month] = [];

    groups[year][month].push({
      id: post.id.toString(),
      title: post.title,
      slug: post.slug,
      publishedAt: post.publishedAt
    });
  });

  const archives = Object.keys(groups)
    .sort((a, b) => Number(b) - Number(a))
    .map(year => {
      const months = Object.keys(groups[Number(year)])
        .sort((a, b) => Number(b) - Number(a))
        .map(month => ({
          month: Number(month),
          posts: groups[Number(year)][Number(month)]
        }));
      
      const totalPosts = months.reduce((acc, curr) => acc + curr.posts.length, 0);

      return {
        year: Number(year),
        months,
        totalPosts
      };
    });

  return archives;
}

export default function TimelinePage() {
    // 获取时间轴的所有文章（或较大的分页大小）
    const { data: posts = [], isLoading } = useQuery({
        queryKey: ['timelinePosts'],
        queryFn: async () => {
             // 在实际应用中，我们可能需要一个专门的时间轴端点或获取全部
             // 重用公共文章 API，选择较大的大小以获取最新的文章
             // 对于完整的时间轴，我们需要分页或轻量级列表端点
             const res = await fetch(`${API_ENDPOINTS.posts}?pageSize=100`);
             if (!res.ok) throw new Error('Network response was not ok');
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
             })) as Post[];
        },
        staleTime: 5 * 60 * 1000, // 缓存 5 分钟
    });

    const archives = useMemo(() => groupPostsByDate(posts), [posts]);

    if (isLoading) {
        return <TimelineLoading />;
    }

    return (
        <div className="min-h-screen bg-background text-[var(--text-primary)] selection:bg-primary/30">
            <main className="max-w-4xl mx-auto px-4 pt-32 pb-12">
                <div className="relative mb-8 pl-4">
                    <h1 className="text-3xl font-bold text-[var(--text-primary)] mb-2">时间轴</h1>
                    <p className="text-[var(--text-muted)] text-sm">共 {posts.length} 篇文章，好事多磨</p>
                    <div className="absolute left-0 top-1 bottom-1 w-1 bg-gradient-to-b from-primary to-purple-600 rounded-full" />
                </div>
                
                <TimelineTree archives={archives} />
            </main>
        </div>
    );
}
