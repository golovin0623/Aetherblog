'use client';

import { motion } from 'framer-motion';
import { Users, Globe } from 'lucide-react';
import FriendCard from '../components/FriendCard';
import { FriendLink } from '../lib/services';

interface FriendsListProps {
  initialFriends: FriendLink[];
}

export default function FriendsList({ initialFriends }: FriendsListProps) {
  return (
    <div className="min-h-screen bg-background text-[var(--text-primary)] selection:bg-primary/30">
      <main className="max-w-6xl mx-auto px-4 pt-24 pb-12">
        {/* 背景环境光 */}
        <div className="fixed top-0 left-0 right-0 h-[500px] pointer-events-none -z-10">
          <div
            className="absolute top-[-100px] right-1/4 w-[600px] h-[500px] bg-primary/10 rounded-full"
            style={{
              filter: 'blur(var(--ambient-glow-blur))',
              opacity: 'var(--ambient-glow-opacity)'
            }}
          />
          <div
            className="absolute top-1/4 left-0 w-[400px] h-[400px] bg-blue-500/10 rounded-full"
            style={{
              filter: 'blur(var(--ambient-glow-blur))',
              opacity: 'var(--ambient-glow-opacity)'
            }}
          />
        </div>
        
        {/* 页面头部 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-10"
        >
          <h1 className="text-3xl font-bold text-[var(--text-primary)] flex items-center gap-3 mb-3">
            <Users className="w-8 h-8 text-primary" />
            友情链接
          </h1>
          <p className="text-[var(--text-muted)] text-lg">
            这里是我的朋友们，欢迎交换友链！
          </p>
        </motion.div>

        {initialFriends.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center py-20 text-[var(--text-muted)] gap-4"
          >
            <div className="w-16 h-16 rounded-full bg-[var(--bg-card)] border border-[var(--border-subtle)] flex items-center justify-center">
              <Globe className="w-8 h-8 opacity-50" />
            </div>
            <p>暂无友链，稍后再来看看吧</p>
          </motion.div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {initialFriends.map((friend, index) => (
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
                  index={index}
                />
              </motion.div>
            ))}
          </div>
        )}

        {/* 友链申请行动号召 */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
          className="mt-16 text-center"
        >
          <p className="text-[var(--text-muted)] text-sm">
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
