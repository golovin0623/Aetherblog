import { create } from 'zustand';
import { PostListItem } from '@/types';

interface PostStore {
  posts: PostListItem[];
  currentPost: PostListItem | null;
  loading: boolean;
  total: number;
  pageNum: number;
  pageSize: number;
  
  setPosts: (posts: PostListItem[], total: number) => void;
  setCurrentPost: (post: PostListItem | null) => void;
  setLoading: (loading: boolean) => void;
  setPage: (pageNum: number, pageSize: number) => void;
  reset: () => void;
}

export const usePostStore = create<PostStore>((set) => ({
  posts: [],
  currentPost: null,
  loading: false,
  total: 0,
  pageNum: 1,
  pageSize: 10,

  setPosts: (posts, total) => set({ posts, total }),
  setCurrentPost: (currentPost) => set({ currentPost }),
  setLoading: (loading) => set({ loading }),
  setPage: (pageNum, pageSize) => set({ pageNum, pageSize }),
  reset: () => set({ posts: [], currentPost: null, total: 0, pageNum: 1 }),
}));
