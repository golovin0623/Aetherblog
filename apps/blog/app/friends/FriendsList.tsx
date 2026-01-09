'use client';

import { motion } from 'framer-motion';
import { Users } from 'lucide-react';
import FriendCard from '../components/FriendCard';
import { FriendLink } from '../lib/services';

const MOCK_FRIENDS: FriendLink[] = [
  {
    id: 1,
    name: 'Google',
    url: 'https://www.google.com',
    logo: 'https://www.gstatic.com/images/branding/product/2x/googleg_48dp.png',
    description: '全球最大的搜索引擎，提供网页、图片、视频等多种搜索服务',
    themeColor: '#4285F4',
  },
  {
    id: 2,
    name: 'GitHub',
    url: 'https://github.com',
    logo: 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png',
    description: '全球最大的代码托管平台，开源社区的家园',
    themeColor: '#24292e',
  },
  {
    id: 3,
    name: 'OpenAI',
    url: 'https://openai.com',
    logo: 'https://cdn.oaistatic.com/assets/favicon-o20kmmos.svg',
    description: 'AI 研究实验室，ChatGPT、GPT-4、DALL·E 的创造者',
    themeColor: '#10A37F',
  },
  {
    id: 4,
    name: 'Apple',
    url: 'https://www.apple.com',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/1/1b/Apple_logo_grey.svg',
    description: '创新科技公司，iPhone、Mac、iPad 的缔造者',
    themeColor: '#555555',
  },
  {
    id: 5,
    name: 'Microsoft',
    url: 'https://www.microsoft.com',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/4/44/Microsoft_logo.svg',
    description: '全球领先的软件公司，Windows、Office、Azure 的开发者',
    themeColor: '#00A4EF',
  },
  {
    id: 6,
    name: '百度',
    url: 'https://www.baidu.com',
    logo: 'https://www.baidu.com/favicon.ico',
    description: '中国最大的搜索引擎，提供搜索、AI、云服务等',
    themeColor: '#2932E1',
  },
];

interface FriendsListProps {
  initialFriends: FriendLink[];
}

export default function FriendsList({ initialFriends }: FriendsListProps) {
  // Use server data if available, otherwise fallback to MOCK
  const displayFriends = initialFriends.length > 0 ? initialFriends : MOCK_FRIENDS;

  return (
    <div className="min-h-screen bg-background text-white selection:bg-primary/30">
      <main className="max-w-6xl mx-auto px-4 pt-24 pb-12">
        {/* Background Ambient Light */}
        <div className="fixed top-0 left-0 right-0 h-[500px] pointer-events-none -z-10">
          <div className="absolute top-[-100px] right-1/4 w-[600px] h-[500px] bg-primary/10 rounded-full blur-[120px] opacity-20" />
          <div className="absolute top-1/4 left-0 w-[400px] h-[400px] bg-blue-500/10 rounded-full blur-[100px] opacity-20" />
        </div>
        
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
                // email/rss not in service interface yet, but defined in mocked data
                // service FriendLink interface is subset. 
                // We can cast or ignore for now.
                index={index}
              />
            </motion.div>
          ))}
        </div>

        {/* Friend Link Application CTA */}
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
      </main>
    </div>
  );
}
