import { LRUCache } from 'lru-cache';

const rateLimitOptions = {
  max: 500,

  // for use with tracking overall storage size
  maxSize: 5000,
  sizeCalculation: (value, key) => {
    return 1;
  },

  // for use when you need to clean up something when objects
  // are evicted from the cache
  dispose: (value, key) => {
    freeFromMemoryOrWhatever(value);
  },

  // how long to live in ms
  ttl: 1000 * 60 * 5,

  // return stale items before removing from cache?
  allowStale: false,

  updateAgeOnGet: false,
  updateAgeOnHas: false,

  // async method to use for cache.fetch(), for
  // stale-while-revalidate type of behavior
  fetchMethod: async (key, staleValue, { options, signal, context }) => {},
};

export const rateLimiter = new LRUCache(rateLimitOptions);

export function limitRequest(ip) {
  const currentRequests = rateLimiter.get(ip) || 0;

  if (currentRequests >= rateLimitOptions.max) {
    return false; // Limit exceeded
  }

  rateLimiter.set(ip, currentRequests + 1);
  return true; // Request allowed
}
