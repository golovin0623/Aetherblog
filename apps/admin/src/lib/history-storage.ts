/**
 * IndexedDB 历史记录存储层
 *
 * 功能：
 * 1. 版本化数据库管理
 * 2. CRUD 操作
 * 3. 查询和过滤
 * 4. 自动清理过期数据
 */

import type { ContentSnapshot } from '@/types/content-history';

const DB_NAME = 'aetherblog-history';
const DB_VERSION = 1;
const STORE_NAME = 'content-snapshots';

/**
 * 历史存储管理器
 */
export class HistoryStorage {
  private db: IDBDatabase | null = null;
  private initPromise: Promise<void> | null = null;

  /**
   * 初始化数据库
   */
  async init(): Promise<void> {
    if (this.db) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        reject(new Error('Failed to open IndexedDB'));
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // 创建对象存储
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });

          // 创建索引
          store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('source', 'source', { unique: false });
          store.createIndex('isBookmark', 'isBookmark', { unique: false });
        }
      };
    });

    return this.initPromise;
  }

  /**
   * 获取对象存储
   */
  private getStore(mode: IDBTransactionMode): IDBObjectStore {
    if (!this.db) throw new Error('Database not initialized');
    const transaction = this.db.transaction([STORE_NAME], mode);
    return transaction.objectStore(STORE_NAME);
  }

  /**
   * 保存快照
   */
  async saveSnapshot(snapshot: ContentSnapshot): Promise<void> {
    await this.init();
    const store = this.getStore('readwrite');

    return new Promise((resolve, reject) => {
      const request = store.put(snapshot);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error('Failed to save snapshot'));
    });
  }

  /**
   * 获取快照
   */
  async getSnapshot(id: string): Promise<ContentSnapshot | null> {
    await this.init();
    const store = this.getStore('readonly');

    return new Promise((resolve, reject) => {
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(new Error('Failed to get snapshot'));
    });
  }

  /**
   * 获取所有快照（按时间倒序）
   */
  async getAllSnapshots(): Promise<ContentSnapshot[]> {
    await this.init();
    const store = this.getStore('readonly');
    const index = store.index('timestamp');

    return new Promise((resolve, reject) => {
      const request = index.openCursor(null, 'prev'); // 倒序
      const snapshots: ContentSnapshot[] = [];

      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          snapshots.push(cursor.value);
          cursor.continue();
        } else {
          resolve(snapshots);
        }
      };

      request.onerror = () => reject(new Error('Failed to get snapshots'));
    });
  }

  /**
   * 获取书签快照
   */
  async getBookmarks(): Promise<ContentSnapshot[]> {
    await this.init();
    const store = this.getStore('readonly');
    const index = store.index('isBookmark');

    return new Promise((resolve, reject) => {
      const request = index.openCursor(IDBKeyRange.only(true), 'prev');
      const bookmarks: ContentSnapshot[] = [];

      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          bookmarks.push(cursor.value);
          cursor.continue();
        } else {
          resolve(bookmarks);
        }
      };

      request.onerror = () => reject(new Error('Failed to get bookmarks'));
    });
  }

  /**
   * 删除快照
   */
  async deleteSnapshot(id: string): Promise<void> {
    await this.init();
    const store = this.getStore('readwrite');

    return new Promise((resolve, reject) => {
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error('Failed to delete snapshot'));
    });
  }

  /**
   * 清空所有快照
   */
  async clearAll(): Promise<void> {
    await this.init();
    const store = this.getStore('readwrite');

    return new Promise((resolve, reject) => {
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error('Failed to clear snapshots'));
    });
  }

  /**
   * 获取快照数量
   */
  async count(): Promise<number> {
    await this.init();
    const store = this.getStore('readonly');

    return new Promise((resolve, reject) => {
      const request = store.count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('Failed to count snapshots'));
    });
  }

  /**
   * 按时间范围查询
   */
  async getSnapshotsByTimeRange(
    startTime: number,
    endTime: number
  ): Promise<ContentSnapshot[]> {
    await this.init();
    const store = this.getStore('readonly');
    const index = store.index('timestamp');
    const range = IDBKeyRange.bound(startTime, endTime);

    return new Promise((resolve, reject) => {
      const request = index.openCursor(range, 'prev');
      const snapshots: ContentSnapshot[] = [];

      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          snapshots.push(cursor.value);
          cursor.continue();
        } else {
          resolve(snapshots);
        }
      };

      request.onerror = () => reject(new Error('Failed to query snapshots'));
    });
  }

  /**
   * 删除最旧的N个快照
   */
  async deleteOldest(count: number): Promise<void> {
    await this.init();
    const store = this.getStore('readwrite');
    const index = store.index('timestamp');

    return new Promise((resolve, reject) => {
      const request = index.openCursor(null, 'next'); // 正序
      let deleted = 0;

      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor && deleted < count) {
          const snapshot = cursor.value as ContentSnapshot;
          // 不删除书签快照
          if (!snapshot.isBookmark) {
            cursor.delete();
            deleted++;
          }
          cursor.continue();
        } else {
          resolve();
        }
      };

      request.onerror = () => reject(new Error('Failed to delete old snapshots'));
    });
  }

  /**
   * 估算存储大小
   */
  async estimateSize(): Promise<number> {
    const snapshots = await this.getAllSnapshots();
    let totalSize = 0;

    for (const snapshot of snapshots) {
      // 粗略估算：JSON 序列化后的字符串长度
      const json = JSON.stringify(snapshot);
      totalSize += json.length * 2; // UTF-16 每字符2字节
    }

    return totalSize;
  }

  /**
   * 关闭数据库连接
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.initPromise = null;
    }
  }
}

// 单例实例
export const historyStorage = new HistoryStorage();
