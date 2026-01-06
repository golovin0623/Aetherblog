'use client';

import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Users } from 'lucide-react';
import FriendCard from '../components/FriendCard';
import FriendsLoading from './FriendsLoading';

interface FriendLink {
  id: number;
  name: string;
  url: string;
  logo?: string;
  description?: string;
  email?: string;
  rssUrl?: string;
  themeColor?: string;
  isOnline?: boolean;
  sortOrder: number;
}

/**
 * 内置模拟友链数据
 * 当 API 不可用或数据库为空时使用
 */
const MOCK_FRIENDS: FriendLink[] = [
  {
    id: 1,
    name: 'Google',
    url: 'https://www.google.com',
    // 使用 Google 的 G 图标而非横向文字 logo
    logo: 'https://www.gstatic.com/images/branding/product/2x/googleg_48dp.png',
    description: '全球最大的搜索引擎，提供网页、图片、视频等多种搜索服务',
    themeColor: '#4285F4',
    sortOrder: 1,
  },
  {
    id: 2,
    name: 'GitHub',
    url: 'https://github.com',
    logo: 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png',
    description: '全球最大的代码托管平台，开源社区的家园',
    themeColor: '#24292e',
    sortOrder: 2,
  },
  {
    id: 3,
    name: 'OpenAI',
    url: 'https://openai.com',
    // 使用紧凑的 OpenAI 图标
    logo: 'https://cdn.oaistatic.com/assets/favicon-o20kmmos.svg',
    description: 'AI 研究实验室，ChatGPT、GPT-4、DALL·E 的创造者',
    themeColor: '#10A37F',
    sortOrder: 3,
  },
  {
    id: 4,
    name: 'Apple',
    url: 'https://www.apple.com',
    // 使用白色/灰色 Apple 图标，避免黑色 logo 在深色背景上不可见
    logo: 'https://upload.wikimedia.org/wikipedia/commons/1/1b/Apple_logo_grey.svg',
    description: '创新科技公司，iPhone、Mac、iPad 的缔造者',
    themeColor: '#555555', // 改为灰色，避免纯黑背景问题
    sortOrder: 4,
  },
  {
    id: 5,
    name: 'Microsoft',
    url: 'https://www.microsoft.com',
    // 使用 Microsoft 四色方块图标
    logo: 'https://upload.wikimedia.org/wikipedia/commons/4/44/Microsoft_logo.svg',
    description: '全球领先的软件公司，Windows、Office、Azure 的开发者',
    themeColor: '#00A4EF',
    sortOrder: 5,
  },
  {
    id: 6,
    name: '百度',
    url: 'https://www.baidu.com',
    // 使用百度熊掌图标
    logo: 'https://www.baidu.com/favicon.ico',
    description: '中国最大的搜索引擎，提供搜索、AI、云服务等',
    themeColor: '#2932E1',
    sortOrder: 6,
  },
];

/**
 * 友链展示页面
 * @ref §3.1.7 - 友链展示模块
 */


export default function FriendsPage() {
  const { data: friends, isLoading, error } = useQuery({
    queryKey: ['friendLinks'],
    queryFn: async () => {
      // 真实环境不使用激进的超时策略，等待后端响应
      try {
        const res = await fetch('http://localhost:8080/v1/friend-links');
        if (!res.ok) throw new Error('API Error');
        const json = await res.json();
        const list = (json.data || []) as FriendLink[];
        // 仅在完全获取失败或无数据时才考虑降级，或者由用户决定 (此处暂时保留空数据降级逻辑，但移除了超时)
        return list.length > 0 ? list : MOCK_FRIENDS;
      } catch (e) {
        console.warn('Backend API unavailable, using mock data:', e);
        // API 故障时返回模拟数据作为兜底
        return MOCK_FRIENDS;
      }
    },
    staleTime: 5 * 60 * 1000,
    // 默认重试配置
  });

  // 始终显示数据（因为有降级策略）
  const displayFriends = friends || MOCK_FRIENDS;

  return (
    <div className="min-h-screen bg-background text-white selection:bg-primary/30">
      <main className="max-w-6xl mx-auto px-4 pt-24 pb-12">
        {/* ... Background & Header ... */}
        
        {/* Page Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-10"
        >
          <h1 className="text-3xl font-bold text-white flex items-center gap-3 mb-3">
            <Users className="w-8 h-8 text-primary" />
            友情链接
          </h1>
          <p className="text-gray-400 text-lg">
            这里是我的朋友们，欢迎交换友链！
          </p>
        </motion.div>

        {/* Loading State - 使用高级骨架屏 */}
        {isLoading ? (
          <FriendsLoading />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {displayFriends.map((friend, index) => (
              <motion.div
                key={friend.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: index * 0.1 }}
              >
                <FriendCard
                  name={friend.name}
                  url={friend.url}
                  avatar={friend.logo || ''}
                  description={friend.description}
                  themeColor={friend.themeColor}
                  email={friend.email}
                  rss={friend.rssUrl}
                  index={index}
                />
              </motion.div>
            ))}
          </div>
        )}

        {/* Friend Link Application CTA */}
        {!isLoading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.8 }}
            className="mt-16 text-center"
          >
            <p className="text-gray-500 text-sm">
              想要交换友链？请在
              <a 
                href="https://github.com" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-primary hover:underline mx-1"
              >
                GitHub Issues
              </a>
              提交申请
            </p>
          </motion.div>
        )}
      </main>
    </div>
  );
}
