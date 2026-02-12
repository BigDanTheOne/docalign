/**
 * Simple in-memory cache with TTL expiry and size-based eviction.
 * TDD-6 Appendix C.
 */

interface CacheEntry<T> {
  data: T;
  expires_at: number;
}

export class SimpleCache {
  private store = new Map<string, CacheEntry<unknown>>();
  private readonly maxEntries: number;

  constructor(maxEntries = 200) {
    this.maxEntries = maxEntries;
  }

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expires_at) {
      this.store.delete(key);
      return null;
    }
    return entry.data as T;
  }

  set<T>(key: string, data: T, ttlSeconds: number): void {
    if (this.store.size >= this.maxEntries) {
      this.evictOldest();
    }
    this.store.set(key, { data, expires_at: Date.now() + ttlSeconds * 1000 });
  }

  get size(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  private evictOldest(): void {
    const entries = [...this.store.entries()]
      .sort((a, b) => a[1].expires_at - b[1].expires_at);
    const toRemove = entries.slice(0, Math.floor(this.maxEntries / 2));
    for (const [key] of toRemove) {
      this.store.delete(key);
    }
  }
}
