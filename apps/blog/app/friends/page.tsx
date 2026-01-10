import type { Metadata } from 'next';
import { getFriendLinks } from '../lib/services';
import FriendsList from './FriendsList';

export const revalidate = 3600; // 1 hour cache

export const metadata: Metadata = {
  title: '友情链接',
  description: '这里是我的朋友们，欢迎交换友链！',
};

export default async function FriendsPage() {
  const friends = await getFriendLinks();
  
  return <FriendsList initialFriends={friends} />;
}
