'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import TimelineTree from '../components/TimelineTree';
import TimelineLoading from './loading';

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

// Client-side helper to group posts
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
    // Fetch all posts for timeline (or a large page size)
    const { data: posts = [], isLoading } = useQuery({
        queryKey: ['timelinePosts'],
        queryFn: async () => {
             // In a real app we might want a specific endpoint for timeline or fetch all
             // Reusing the public posts API, picking a large size to get most recent ones
             // For a full timeline, we'd need pagination or a light-weight list endpoint
             const res = await fetch('http://localhost:8080/api/v1/public/posts?pageSize=100');
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
        staleTime: 5 * 60 * 1000, // 5 minutes cache
    });

    const archives = useMemo(() => groupPostsByDate(posts), [posts]);

    if (isLoading) {
        return <TimelineLoading />;
    }

    return (
        <div className="min-h-screen bg-background text-white selection:bg-primary/30">
            <main className="max-w-4xl mx-auto px-4 pt-32 pb-12">
                <div className="relative mb-8 pl-4">
                    <h1 className="text-3xl font-bold text-white mb-2">时间轴</h1>
                    <p className="text-gray-500 text-sm">共 {posts.length} 篇文章，持续创作中...</p>
                    <div className="absolute left-0 top-1 bottom-1 w-1 bg-gradient-to-b from-primary to-purple-600 rounded-full" />
                </div>
                
                <TimelineTree archives={archives} />
            </main>
        </div>
    );
}
