import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SimpleCache } from '../../../src/layers/L6-mcp/cache';

describe('SimpleCache', () => {
  let cache: SimpleCache;

  beforeEach(() => {
    cache = new SimpleCache(10); // Small max for eviction tests
  });

  it('returns null for missing key', () => {
    expect(cache.get('nonexistent')).toBeNull();
  });

  it('stores and retrieves a value', () => {
    cache.set('key1', { data: 'hello' }, 60);
    expect(cache.get('key1')).toEqual({ data: 'hello' });
  });

  it('returns null for expired entry', () => {
    vi.useFakeTimers();
    try {
      cache.set('key1', 'value', 5);
      expect(cache.get('key1')).toBe('value');

      // Advance past TTL
      vi.advanceTimersByTime(6000);
      expect(cache.get('key1')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('deletes expired entry on get', () => {
    vi.useFakeTimers();
    try {
      cache.set('key1', 'value', 1);
      expect(cache.size).toBe(1);

      vi.advanceTimersByTime(2000);
      cache.get('key1');
      expect(cache.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('tracks size correctly', () => {
    expect(cache.size).toBe(0);
    cache.set('a', 1, 60);
    cache.set('b', 2, 60);
    expect(cache.size).toBe(2);
  });

  it('clears all entries', () => {
    cache.set('a', 1, 60);
    cache.set('b', 2, 60);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get('a')).toBeNull();
  });

  it('evicts oldest entries when at capacity', () => {
    vi.useFakeTimers();
    try {
      // Fill to max (10 entries)
      for (let i = 0; i < 10; i++) {
        cache.set(`key${i}`, i, 60 + i); // Increasing TTL so expires_at varies
        vi.advanceTimersByTime(10); // Ensure different timestamps
      }
      expect(cache.size).toBe(10);

      // Add one more, should trigger eviction of oldest half (5)
      cache.set('key10', 10, 60);
      expect(cache.size).toBeLessThanOrEqual(6); // 10 - 5 + 1

      // Oldest entries should be evicted (lowest expires_at)
      expect(cache.get('key0')).toBeNull();
      expect(cache.get('key1')).toBeNull();

      // Newest entries should still exist
      expect(cache.get('key10')).toBe(10);
      expect(cache.get('key9')).toBe(9);
    } finally {
      vi.useRealTimers();
    }
  });

  it('overwrites existing key', () => {
    cache.set('key1', 'first', 60);
    cache.set('key1', 'second', 60);
    expect(cache.get('key1')).toBe('second');
    expect(cache.size).toBe(1);
  });

  it('handles various data types', () => {
    cache.set('str', 'hello', 60);
    cache.set('num', 42, 60);
    cache.set('arr', [1, 2, 3], 60);
    cache.set('obj', { nested: { deep: true } }, 60);

    expect(cache.get('str')).toBe('hello');
    expect(cache.get('num')).toBe(42);
    expect(cache.get('arr')).toEqual([1, 2, 3]);
    expect(cache.get('obj')).toEqual({ nested: { deep: true } });
  });

  it('default max entries is 200', () => {
    const defaultCache = new SimpleCache();
    // Fill 200 entries - should not evict
    for (let i = 0; i < 200; i++) {
      defaultCache.set(`k${i}`, i, 60);
    }
    expect(defaultCache.size).toBe(200);
  });
});
