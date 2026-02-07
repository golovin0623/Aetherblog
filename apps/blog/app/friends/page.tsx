import type { Metadata } from 'next';
import { getFriendLinks } from '../lib/services';
import FriendsList from './FriendsList';

export const revalidate = 0; // 禁用缓存，确保每次都获取最新数据
export const dynamic = 'force-dynamic'; // 强制动态渲染

export const metadata: Metadata = {
  title: '友情链接',
  description: '这里是我的朋友们，欢迎交换友链！',
};

export default async function FriendsPage() {
  const friends = await getFriendLinks();
  
  return <FriendsList initialFriends={friends} />;
}
