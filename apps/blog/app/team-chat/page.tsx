import type { Metadata } from 'next';
import TeamChatClient from './TeamChatClient';

export const metadata: Metadata = {
  title: '团队聊天',
  robots: { index: false, follow: false },
};

export default function TeamChatPage() {
  return (
    <div
      className="px-3 pb-4 sm:px-4"
      style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 5rem)' }}
    >
      <TeamChatClient />
    </div>
  );
}
