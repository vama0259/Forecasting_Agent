// Factory for creating and configuring ioredis client instances.

import { Redis } from 'ioredis';

// Creates and returns a connected Redis client instance for the specified connection URL.
export function createRedisClient(url: string): Redis {
  return new Redis(url);
}
