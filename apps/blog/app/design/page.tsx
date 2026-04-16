import type { Metadata } from 'next';
import { getSiteSettings } from '@/app/lib/services';
import DesignClient from './DesignClient';

// 10 分钟 ISR,与 /about 对齐
export const revalidate = 600;

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSiteSettings();
  const title = `设计的推理链 · ${settings.siteTitle || 'AetherBlog'}`;
  const description =
    'AetherBlog · Aether Codex 设计系统的推理链:为什么我们做每一个决定。OKLCH 色彩工程、9 级字号阶梯、4 层玻璃、五个签名时刻。';
  return {
    title,
    description,
    openGraph: {
      type: 'article',
      title,
      description,
    },
  };
}

export default async function DesignPage() {
  const settings = await getSiteSettings();
  return <DesignClient siteTitle={settings.siteTitle || 'AetherBlog'} />;
}
