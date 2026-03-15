// Middleware Licenze per DocuVault
// Verifica validità licenza e limiti

import { Request, Response, NextFunction } from 'express';
import { validateLicense, hasFeature, checkUserLimit, checkStorageLimit } from '../services/license.service.js';
import { LicenseFeature, LicenseError } from '../types/index.js';
import { logger } from '../utils/logger.js';

/**
 * Middleware per verificare che la licenza sia valida
 */
export function requireValidLicense(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({
      success: false,
      error: 'Autenticazione richiesta',
      code: 'AUTHENTICATION_REQUIRED',
    });
    return;
  }

  validateLicense(req.user.organizationId)
    .then((isValid) => {
      if (!isValid) {
        res.status(403).json({
          success: false,
          error: 'Licenza non valida o scaduta',
          code: 'LICENSE_INVALID',
        });
        return;
      }
      next();
    })
    .catch((error) => {
      logger.error('Errore verifica licenza', { error: (error as Error).message });
      res.status(403).json({
        success: false,
        error: 'Errore verifica licenza',
        code: 'LICENSE_CHECK_ERROR',
      });
    });
}

/**
 * Middleware per verificare che una feature sia abilitata nel piano
 */
export function requireFeature(feature: LicenseFeature) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: 'Autenticazione richiesta',
        code: 'AUTHENTICATION_REQUIRED',
      });
      return;
    }

    hasFeature(req.user.organizationId, feature)
      .then((enabled) => {
        if (!enabled) {
          res.status(403).json({
            success: false,
            error: `Feature "${feature}" non disponibile nel piano corrente`,
            code: 'FEATURE_NOT_AVAILABLE',
            details: { feature },
          });
          return;
        }
        next();
      })
      .catch((error) => {
        logger.error('Errore verifica feature', { error: (error as Error).message, feature });
        res.status(403).json({
          success: false,
          error: 'Errore verifica feature',
          code: 'FEATURE_CHECK_ERROR',
        });
      });
  };
}

/**
 * Middleware per verificare limite utenti prima di crearne uno nuovo
 */
export function checkUserLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({
      success: false,
      error: 'Autenticazione richiesta',
      code: 'AUTHENTICATION_REQUIRED',
    });
    return;
  }

  checkUserLimit(req.user.organizationId)
    .then((canAddUser) => {
      if (!canAddUser) {
        res.status(403).json({
          success: false,
          error: 'Limite utenti raggiunto per il piano corrente',
          code: 'USER_LIMIT_REACHED',
        });
        return;
      }
      next();
    })
    .catch((error) => {
      logger.error('Errore verifica limite utenti', { error: (error as Error).message });
      res.status(403).json({
        success: false,
        error: 'Errore verifica limite utenti',
        code: 'USER_LIMIT_CHECK_ERROR',
      });
    });
}

/**
 * Middleware per verificare limite storage prima di upload
 */
export function checkStorageLimitMiddleware(additionalMBGetter?: (req: Request) => number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: 'Autenticazione richiesta',
        code: 'AUTHENTICATION_REQUIRED',
      });
      return;
    }

    // Calcola MB aggiuntivi se fornita la funzione
    let additionalMB = 0;
    if (additionalMBGetter) {
      additionalMB = additionalMBGetter(req);
    } else if (req.file) {
      additionalMB = req.file.size / (1024 * 1024);
    } else if (req.files && Array.isArray(req.files)) {
      additionalMB = req.files.reduce((sum, file) => sum + file.size, 0) / (1024 * 1024);
    }

    checkStorageLimit(req.user.organizationId, additionalMB)
      .then((canUpload) => {
        if (!canUpload) {
          res.status(403).json({
            success: false,
            error: 'Limite storage raggiunto per il piano corrente',
            code: 'STORAGE_LIMIT_REACHED',
          });
          return;
        }
        next();
      })
      .catch((error) => {
        logger.error('Errore verifica limite storage', { error: (error as Error).message });
        res.status(403).json({
          success: false,
          error: 'Errore verifica limite storage',
          code: 'STORAGE_LIMIT_CHECK_ERROR',
        });
      });
  };
}

/**
 * Middleware combinato per route protette
 */
export function requireLicensedAccess(features?: LicenseFeature[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: 'Autenticazione richiesta',
        code: 'AUTHENTICATION_REQUIRED',
      });
      return;
    }

    try {
      // Verifica licenza valida
      const isValid = await validateLicense(req.user.organizationId);
      if (!isValid) {
        res.status(403).json({
          success: false,
          error: 'Licenza non valida o scaduta',
          code: 'LICENSE_INVALID',
        });
        return;
      }

      // Verifica features se specificate
      if (features && features.length > 0) {
        for (const feature of features) {
          const enabled = await hasFeature(req.user.organizationId, feature);
          if (!enabled) {
            res.status(403).json({
              success: false,
              error: `Feature "${feature}" non disponibile nel piano corrente`,
              code: 'FEATURE_NOT_AVAILABLE',
              details: { feature },
            });
            return;
          }
        }
      }

      next();
    } catch (error) {
      logger.error('Errore verifica accesso licensiato', { error: (error as Error).message });
      res.status(403).json({
        success: false,
        error: 'Errore verifica licenza',
        code: 'LICENSE_CHECK_ERROR',
      });
    }
  };
}
