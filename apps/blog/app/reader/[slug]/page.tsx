import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { SERVER_API_URL } from '@/app/lib/api';
import { logger } from '@/app/lib/logger';
import PageFlipBook, { type ReadingBook } from './PageFlipBook';

const API_BASE_URL = SERVER_API_URL;

interface PageProps {
  params: Promise<{ slug: string }>;
}

async function fetchBook(url: string, cookie?: string): Promise<ReadingBook | null> {
  try {
    const res = await fetch(url, {
      cache: 'no-store',
      headers: cookie ? { Cookie: cookie } : undefined,
    });
    if (!res.ok) {
      return null;
    }
    const json = await res.json();
    if (json.code === 200 && json.data) {
      return json.data as ReadingBook;
    }
    return null;
  } catch (err) {
    logger.error('Failed to fetch reading book:', err);
    return null;
  }
}

async function getBook(slug: string): Promise<ReadingBook | null> {
  const encodedSlug = encodeURIComponent(slug);
  const publicBook = await fetchBook(`${API_BASE_URL}/api/v1/public/reading-books/${encodedSlug}`);
  if (publicBook) {
    return publicBook;
  }

  const cookie = (await headers()).get('cookie');
  if (!cookie) {
    return null;
  }
  return fetchBook(`${API_BASE_URL}/api/v1/admin/reading-books/slug/${encodedSlug}`, cookie);
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const book = await getBook(slug);
  if (!book) {
    return { title: '拟真阅读' };
  }
  return {
    title: `${book.title} · 拟真阅读`,
    description: `沉浸式翻页阅读《${book.title}》`,
  };
}

export default async function ReaderPage({ params }: PageProps) {
  const { slug } = await params;
  const book = await getBook(slug);
  if (!book) {
    notFound();
  }
  return <PageFlipBook book={book} />;
}
