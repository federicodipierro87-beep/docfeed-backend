// DocuVault Backend - Entry Point
// Sistema di gestione documentale enterprise

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import { connectPrisma, disconnectPrisma } from './services/prisma.service.js';
import { connectRedis, disconnectRedis } from './services/redis.service.js';
import { initializeStorage } from './services/storage.service.js';
import { getOCRQueue, closeOCRQueue } from './services/ocr.service.js';
import { getRetentionQueue, closeRetentionQueue } from './services/retention.service.js';
import { errorHandler, notFoundHandler } from './middleware/error.middleware.js';
import routes from './routes/index.js';
import { logger } from './utils/logger.js';

const app = express();
const PORT = process.env.PORT || 3000;

// === MIDDLEWARE GLOBALI ===

// Security headers
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// CORS
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Rate limiting globale
app.use(rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 100, // 100 richieste per minuto
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Troppe richieste. Riprova più tardi.',
    code: 'RATE_LIMIT_EXCEEDED',
  },
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging
app.use((req, res, next) => {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.httpRequest(req.method, req.path, res.statusCode, duration);
  });

  next();
});

// === ROUTES ===

app.use('/api', routes);

// === ERROR HANDLING ===

app.use(notFoundHandler);
app.use(errorHandler);

// === STARTUP ===

async function start(): Promise<void> {
  try {
    logger.info('Avvio DocuVault Backend...');

    // Connessione database
    await connectPrisma();

    // Connessione Redis
    try {
      await connectRedis();
    } catch (redisError) {
      logger.warn('Redis non disponibile, alcune funzionalità saranno limitate', {
        error: (redisError as Error).message,
      });
      // Continua senza Redis per ora
    }

    // Inizializzazione storage
    await initializeStorage();

    // Inizializzazione queue OCR
    if (process.env.OCR_ENABLED === 'true') {
      getOCRQueue();
      logger.info('Queue OCR inizializzata');
    }

    // Inizializzazione queue retention
    getRetentionQueue();
    logger.info('Queue retention inizializzata');

    // Avvio server
    app.listen(PORT, () => {
      logger.info(`Server avviato su porta ${PORT}`);
      logger.info(`Ambiente: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`Health check: http://localhost:${PORT}/api/health`);
    });
  } catch (error) {
    logger.error('Errore avvio server', { error: (error as Error).message });
    process.exit(1);
  }
}

// === GRACEFUL SHUTDOWN ===

async function shutdown(signal: string): Promise<void> {
  logger.info(`Ricevuto segnale ${signal}, avvio shutdown...`);

  try {
    // Chiudi queue
    await closeOCRQueue();
    await closeRetentionQueue();

    // Chiudi connessioni
    await disconnectRedis();
    await disconnectPrisma();

    logger.info('Shutdown completato');
    process.exit(0);
  } catch (error) {
    logger.error('Errore durante shutdown', { error: (error as Error).message });
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', { error: error.message, stack: error.stack });
  shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Rejection', { reason });
  shutdown('unhandledRejection');
});

// Avvia applicazione
start();

export default app;
