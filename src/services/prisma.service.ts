// Servizio Prisma per DocuVault
// Singleton per la connessione al database

import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger.js';

declare global {
  // Evita multiple istanze in development con hot reload
  var prisma: PrismaClient | undefined;
}

const createPrismaClient = (): PrismaClient => {
  const client = new PrismaClient({
    log: process.env.NODE_ENV === 'development'
      ? ['query', 'error', 'warn']
      : ['error'],
  });

  // Middleware per logging delle query in development
  if (process.env.NODE_ENV === 'development') {
    client.$use(async (params, next) => {
      const before = Date.now();
      const result = await next(params);
      const after = Date.now();
      logger.debug(`Query ${params.model}.${params.action} took ${after - before}ms`);
      return result;
    });
  }

  return client;
};

export const prisma = global.prisma || createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  global.prisma = prisma;
}

// Gestione graceful shutdown
export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
  logger.info('Disconnesso da PostgreSQL');
}

// Connessione iniziale con retry
export async function connectPrisma(): Promise<void> {
  const maxRetries = 5;
  let retries = 0;

  while (retries < maxRetries) {
    try {
      await prisma.$connect();
      logger.info('Connesso a PostgreSQL');
      return;
    } catch (error) {
      retries++;
      logger.warn(`Tentativo connessione DB ${retries}/${maxRetries} fallito`);
      if (retries === maxRetries) {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 2000 * retries));
    }
  }
}
