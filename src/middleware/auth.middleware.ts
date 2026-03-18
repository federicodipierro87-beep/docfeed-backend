// Middleware di Autenticazione per DocuVault
// Verifica JWT e gestione ruoli

import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../services/auth.service.js';
import { isAccessTokenBlacklisted } from '../services/redis.service.js';
import { JwtPayload, AuthenticationError, AuthorizationError } from '../types/index.js';
import { UserRole } from '@prisma/client';

// Estendi il tipo Request per includere l'utente
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload & { jti: string };
    }
  }
}

/**
 * Middleware per verificare l'autenticazione JWT
 */
export function authenticate(req: Request, res: Response, next: NextFunction): void {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AuthenticationError('Token non fornito');
    }

    const token = authHeader.substring(7);

    // Verifica e decodifica token
    const payload = verifyAccessToken(token);

    // Verifica se token è nella blacklist (per logout)
    isAccessTokenBlacklisted(payload.jti)
      .then((isBlacklisted) => {
        if (isBlacklisted) {
          res.status(401).json({
            success: false,
            error: 'Token revocato',
            code: 'TOKEN_REVOKED',
          });
          return;
        }

        // Aggiungi payload alla request
        req.user = payload;
        next();
      })
      .catch(next);
  } catch (error) {
    if (error instanceof AuthenticationError) {
      res.status(401).json({
        success: false,
        error: error.message,
        code: error.code,
      });
    } else {
      next(error);
    }
  }
}

/**
 * Middleware per verificare ruolo minimo
 */
export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: 'Autenticazione richiesta',
        code: 'AUTHENTICATION_REQUIRED',
      });
      return;
    }

    if (!roles.includes(req.user.role as UserRole)) {
      res.status(403).json({
        success: false,
        error: `Ruolo richiesto: ${roles.join(' o ')}`,
        code: 'INSUFFICIENT_ROLE',
      });
      return;
    }

    next();
  };
}

/**
 * Middleware per verificare che l'utente sia admin
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({
      success: false,
      error: 'Autenticazione richiesta',
      code: 'AUTHENTICATION_REQUIRED',
    });
    return;
  }

  if (req.user.role !== UserRole.ADMIN) {
    res.status(403).json({
      success: false,
      error: 'Richiesti privilegi di amministratore',
      code: 'ADMIN_REQUIRED',
    });
    return;
  }

  next();
}

/**
 * Middleware per verificare che l'utente sia admin o manager
 */
export function requireManager(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({
      success: false,
      error: 'Autenticazione richiesta',
      code: 'AUTHENTICATION_REQUIRED',
    });
    return;
  }

  if (req.user.role !== UserRole.ADMIN && req.user.role !== UserRole.MANAGER) {
    res.status(403).json({
      success: false,
      error: 'Richiesti privilegi di manager o superiori',
      code: 'MANAGER_REQUIRED',
    });
    return;
  }

  next();
}

/**
 * Middleware per autenticazione con token in query string (per download/apertura file)
 */
export function authenticateWithQueryToken(req: Request, res: Response, next: NextFunction): void {
  try {
    // Prima prova query parameter
    let token = req.query.token as string | undefined;

    // Fallback a header Authorization
    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
      }
    }

    if (!token) {
      throw new AuthenticationError('Token non fornito');
    }

    // Verifica e decodifica token
    const payload = verifyAccessToken(token);

    // Verifica se token è nella blacklist (per logout)
    isAccessTokenBlacklisted(payload.jti)
      .then((isBlacklisted) => {
        if (isBlacklisted) {
          res.status(401).json({
            success: false,
            error: 'Token revocato',
            code: 'TOKEN_REVOKED',
          });
          return;
        }

        // Aggiungi payload alla request
        req.user = payload;
        next();
      })
      .catch(next);
  } catch (error) {
    if (error instanceof AuthenticationError) {
      res.status(401).json({
        success: false,
        error: error.message,
        code: error.code,
      });
    } else {
      next(error);
    }
  }
}

/**
 * Middleware opzionale - non blocca se non autenticato
 */
export function optionalAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    // Prosegui senza autenticazione
    next();
    return;
  }

  const token = authHeader.substring(7);

  try {
    const payload = verifyAccessToken(token);

    isAccessTokenBlacklisted(payload.jti)
      .then((isBlacklisted) => {
        if (!isBlacklisted) {
          req.user = payload;
        }
        next();
      })
      .catch(() => {
        // In caso di errore Redis, prosegui comunque
        next();
      });
  } catch {
    // Token non valido, prosegui senza autenticazione
    next();
  }
}

/**
 * Middleware per verificare ownership o admin
 */
export function requireOwnerOrAdmin(
  getOwnerId: (req: Request) => Promise<string | null>
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: 'Autenticazione richiesta',
        code: 'AUTHENTICATION_REQUIRED',
      });
      return;
    }

    // Admin può sempre accedere
    if (req.user.role === UserRole.ADMIN) {
      next();
      return;
    }

    try {
      const ownerId = await getOwnerId(req);

      if (ownerId === req.user.userId) {
        next();
        return;
      }

      res.status(403).json({
        success: false,
        error: 'Accesso non autorizzato a questa risorsa',
        code: 'NOT_OWNER',
      });
    } catch (error) {
      next(error);
    }
  };
}
