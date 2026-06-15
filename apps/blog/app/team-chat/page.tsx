import type { Metadata } from 'next';
import TeamChatClient from './TeamChatClient';

export const metadata: Metadata = {
  title: '团队聊天',
  robots: { index: false, follow: false },
};

export default function TeamChatPage() {
  return (
    <div className="px-4 py-8">
      <TeamChatClient />
    </div>
  );
}
