// Middleware di Error Handling per DocuVault
// Gestione centralizzata errori

import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { AppError, ValidationError } from '../types/index.js';
import { logger } from '../utils/logger.js';

/**
 * Middleware per gestione errori globale
 */
export function errorHandler(
  error: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Log errore
  logger.logError(error, {
    method: req.method,
    path: req.path,
    userId: req.user?.userId,
  });

  // Errori applicativi custom
  if (error instanceof AppError) {
    res.status(error.statusCode).json({
      success: false,
      error: error.message,
      code: error.code,
      details: error.details,
    });
    return;
  }

  // Errori di validazione Zod
  if (error instanceof ZodError) {
    const formattedErrors = error.errors.map((err) => ({
      field: err.path.join('.'),
      message: err.message,
    }));

    res.status(400).json({
      success: false,
      error: 'Errore di validazione',
      code: 'VALIDATION_ERROR',
      details: { errors: formattedErrors },
    });
    return;
  }

  // Errori Prisma
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    handlePrismaError(error, res);
    return;
  }

  if (error instanceof Prisma.PrismaClientValidationError) {
    res.status(400).json({
      success: false,
      error: 'Dati non validi',
      code: 'PRISMA_VALIDATION_ERROR',
    });
    return;
  }

  // Errori JWT
  if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
    res.status(401).json({
      success: false,
      error: error.message,
      code: 'JWT_ERROR',
    });
    return;
  }

  // Errore generico (non esporre dettagli in produzione)
  const isDevelopment = process.env.NODE_ENV === 'development';

  res.status(500).json({
    success: false,
    error: isDevelopment ? error.message : 'Errore interno del server',
    code: 'INTERNAL_SERVER_ERROR',
    ...(isDevelopment && { stack: error.stack }),
  });
}

/**
 * Gestisce errori specifici di Prisma
 */
function handlePrismaError(
  error: Prisma.PrismaClientKnownRequestError,
  res: Response
): void {
  switch (error.code) {
    case 'P2002': {
      // Unique constraint violation
      const target = (error.meta?.target as string[])?.join(', ') || 'campo';
      res.status(409).json({
        success: false,
        error: `Valore duplicato per: ${target}`,
        code: 'UNIQUE_CONSTRAINT_VIOLATION',
        details: { field: target },
      });
      break;
    }

    case 'P2003': {
      // Foreign key constraint violation
      res.status(400).json({
        success: false,
        error: 'Riferimento a risorsa non esistente',
        code: 'FOREIGN_KEY_VIOLATION',
      });
      break;
    }

    case 'P2025': {
      // Record not found
      res.status(404).json({
        success: false,
        error: 'Risorsa non trovata',
        code: 'NOT_FOUND',
      });
      break;
    }

    case 'P2014': {
      // Required relation violation
      res.status(400).json({
        success: false,
        error: 'Operazione violerebbe relazione richiesta',
        code: 'RELATION_VIOLATION',
      });
      break;
    }

    default:
      res.status(500).json({
        success: false,
        error: 'Errore database',
        code: `PRISMA_${error.code}`,
      });
  }
}

/**
 * Middleware per route non trovate
 */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    error: `Route non trovata: ${req.method} ${req.path}`,
    code: 'ROUTE_NOT_FOUND',
  });
}

/**
 * Wrapper per gestire errori async nei controller
 */
export function asyncHandler<T>(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<T>
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Valida body con schema Zod
 */
export function validateBody<T>(schema: { parse: (data: unknown) => T }) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Valida query params con schema Zod
 */
export function validateQuery<T>(schema: { parse: (data: unknown) => T }) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      req.query = schema.parse(req.query) as typeof req.query;
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Valida params con schema Zod
 */
export function validateParams<T>(schema: { parse: (data: unknown) => T }) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      req.params = schema.parse(req.params) as typeof req.params;
      next();
    } catch (error) {
      next(error);
    }
  };
}
