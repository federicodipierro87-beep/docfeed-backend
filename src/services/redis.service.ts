// Servizio Redis per DocuVault
// Gestione cache e session tokens

import Redis from 'ioredis';
import { logger } from '../utils/logger.js';

let redis: Redis | null = null;

export function getRedis(): Redis {
  if (!redis) {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

    redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        if (times > 3) {
          logger.error('Redis: troppi tentativi di riconnessione');
          return null;
        }
        return Math.min(times * 200, 2000);
      },
      connectTimeout: 10000,
      lazyConnect: false, // Connetti subito
    });

    redis.on('connect', () => {
      logger.info('Connesso a Redis');
    });

    redis.on('error', (error) => {
      logger.error('Errore Redis', { error: error.message });
    });

    redis.on('close', () => {
      logger.warn('Connessione Redis chiusa');
    });
  }

  return redis;
}

export async function connectRedis(): Promise<void> {
  const client = getRedis();
  if (client.status !== 'ready' && client.status !== 'connect') {
    await new Promise<void>((resolve, reject) => {
      client.once('ready', resolve);
      client.once('error', reject);
    });
  }
}

export async function disconnectRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
    logger.info('Disconnesso da Redis');
  }
}

// === OPERAZIONI CACHE ===

const DEFAULT_TTL = 3600; // 1 ora

export async function cacheGet<T>(key: string): Promise<T | null> {
  const client = getRedis();
  const value = await client.get(key);
  if (!value) return null;

  try {
    return JSON.parse(value) as T;
  } catch {
    return value as unknown as T;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number = DEFAULT_TTL): Promise<void> {
  const client = getRedis();
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  await client.setex(key, ttlSeconds, serialized);
}

export async function cacheDelete(key: string): Promise<void> {
  const client = getRedis();
  await client.del(key);
}

export async function cacheDeletePattern(pattern: string): Promise<void> {
  const client = getRedis();
  const keys = await client.keys(pattern);
  if (keys.length > 0) {
    await client.del(...keys);
  }
}

// === REFRESH TOKENS ===

const REFRESH_TOKEN_PREFIX = 'refresh_token:';
const REVOKED_TOKEN_PREFIX = 'revoked_token:';

export async function storeRefreshToken(
  userId: string,
  tokenId: string,
  expiresInSeconds: number
): Promise<void> {
  const client = getRedis();
  const key = `${REFRESH_TOKEN_PREFIX}${userId}:${tokenId}`;
  await client.setex(key, expiresInSeconds, 'valid');
}

export async function isRefreshTokenValid(userId: string, tokenId: string): Promise<boolean> {
  const client = getRedis();
  const key = `${REFRESH_TOKEN_PREFIX}${userId}:${tokenId}`;
  const value = await client.get(key);
  return value === 'valid';
}

export async function revokeRefreshToken(userId: string, tokenId: string): Promise<void> {
  const client = getRedis();
  const key = `${REFRESH_TOKEN_PREFIX}${userId}:${tokenId}`;
  await client.del(key);
}

export async function revokeAllUserTokens(userId: string): Promise<void> {
  const pattern = `${REFRESH_TOKEN_PREFIX}${userId}:*`;
  await cacheDeletePattern(pattern);
}

export async function blacklistAccessToken(tokenId: string, expiresInSeconds: number): Promise<void> {
  const client = getRedis();
  const key = `${REVOKED_TOKEN_PREFIX}${tokenId}`;
  await client.setex(key, expiresInSeconds, 'revoked');
}

export async function isAccessTokenBlacklisted(tokenId: string): Promise<boolean> {
  const client = getRedis();
  const key = `${REVOKED_TOKEN_PREFIX}${tokenId}`;
  const value = await client.get(key);
  return value === 'revoked';
}

// === RATE LIMITING ===

const RATE_LIMIT_PREFIX = 'rate_limit:';

export async function checkRateLimit(
  identifier: string,
  maxRequests: number,
  windowSeconds: number
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  const client = getRedis();
  const key = `${RATE_LIMIT_PREFIX}${identifier}`;
  const now = Date.now();
  const windowStart = now - (windowSeconds * 1000);

  // Rimuovi richieste vecchie
  await client.zremrangebyscore(key, 0, windowStart);

  // Conta richieste nella finestra
  const count = await client.zcard(key);

  if (count >= maxRequests) {
    const oldestTimestamp = await client.zrange(key, 0, 0, 'WITHSCORES');
    const resetAt = oldestTimestamp.length > 1
      ? parseInt(oldestTimestamp[1]) + (windowSeconds * 1000)
      : now + (windowSeconds * 1000);

    return {
      allowed: false,
      remaining: 0,
      resetAt,
    };
  }

  // Aggiungi nuova richiesta
  await client.zadd(key, now, `${now}`);
  await client.expire(key, windowSeconds);

  return {
    allowed: true,
    remaining: maxRequests - count - 1,
    resetAt: now + (windowSeconds * 1000),
  };
}

// === LICENSE CACHE ===

const LICENSE_CACHE_PREFIX = 'license:';
const LICENSE_CACHE_TTL = 300; // 5 minuti

export async function cacheLicenseInfo(organizationId: string, licenseInfo: unknown): Promise<void> {
  const key = `${LICENSE_CACHE_PREFIX}${organizationId}`;
  await cacheSet(key, licenseInfo, LICENSE_CACHE_TTL);
}

export async function getCachedLicenseInfo<T>(organizationId: string): Promise<T | null> {
  const key = `${LICENSE_CACHE_PREFIX}${organizationId}`;
  return cacheGet<T>(key);
}

export async function invalidateLicenseCache(organizationId: string): Promise<void> {
  const key = `${LICENSE_CACHE_PREFIX}${organizationId}`;
  await cacheDelete(key);
}
