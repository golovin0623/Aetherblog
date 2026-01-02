/**
 * 评论类型
 */

export type CommentStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SPAM';

export interface Comment {
  id: number;
  postId: number;
  parentId?: number;
  nickname: string;
  email?: string;
  website?: string;
  avatar?: string;
  content: string;
  status: CommentStatus;
  ip?: string;
  createdAt: string;
  children?: Comment[];
}

export interface CreateCommentInput {
  postId: number;
  parentId?: number;
  nickname: string;
  email?: string;
  website?: string;
  content: string;
}
