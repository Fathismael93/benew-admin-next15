import { LRU } from 'lru-cache';

const rateLimitOptions = {
  max: 10, // Allow 10 requests
  ttl: 60 * 1000, // Per minute (60,000 ms)
};

const rateLimiter = new LRU(rateLimitOptions);

export function limitRequest(ip) {
  const currentRequests = rateLimiter.get(ip) || 0;

  if (currentRequests >= rateLimitOptions.max) {
    return false; // Limit exceeded
  }

  rateLimiter.set(ip, currentRequests + 1);
  return true; // Request allowed
}
