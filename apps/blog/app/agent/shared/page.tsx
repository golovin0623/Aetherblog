import type { Metadata } from 'next';
import SharedContentClient from './SharedContentClient';

export const metadata: Metadata = {
  title: '共享内容 · 灵境',
  robots: { index: false, follow: false },
};

export default function SharedContentPage() {
  return <SharedContentClient />;
}
