/**
 * View Transitions API 类型声明
 * 
 * View Transitions API 是一个相对较新的浏览器特性。
 * 此文件添加该 API 的 TypeScript 类型声明。
 */

interface ViewTransition {
  ready: Promise<void>;
  finished: Promise<void>;
  updateCallbackDone: Promise<void>;
  skipTransition(): void;
}

interface Document {
  startViewTransition?(callback: () => void | Promise<void>): ViewTransition;
}
