import type { Metadata } from 'next';
import MusicHallExperience from '../components/MusicHallExperience';

export const metadata: Metadata = {
  title: '音乐大厅',
  description: 'AetherBlog 音乐大厅，提供歌单、歌词、封面动效与后台播放体验。',
};

export default function MusicPage() {
  return <MusicHallExperience />;
}
