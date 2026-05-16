import type { Metadata } from 'next';
import SharedPostClient from './SharedPostClient';

export const metadata: Metadata = {
  title: '共享文章 · 灵境',
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function SharedPostPage({ params }: PageProps) {
  const { id } = await params;
  return <SharedPostClient id={id} />;
}
