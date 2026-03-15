// Routes Licenze per DocuVault

import { Router } from 'express';
import {
  getLicenseInfo,
  getLicenseStats,
  activateLicense,
  renewLicense,
  upgradeLicense,
} from '../services/license.service.js';
import { authenticate, requireAdmin } from '../middleware/auth.middleware.js';
import { asyncHandler, validateBody } from '../middleware/error.middleware.js';
import { activateLicenseSchema } from '../utils/validation.js';
import { JwtPayload } from '../types/index.js';

const router = Router();

// Middleware autenticazione
router.use(authenticate);

// Info licenza corrente
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const licenseInfo = await getLicenseInfo(req.user!.organizationId);

    res.json({ success: true, data: licenseInfo });
  })
);

// Statistiche licenza (solo admin)
router.get(
  '/stats',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const stats = await getLicenseStats(req.user!.organizationId);

    res.json({ success: true, data: stats });
  })
);

// Attiva nuova licenza (solo admin)
router.post(
  '/activate',
  requireAdmin,
  validateBody(activateLicenseSchema),
  asyncHandler(async (req, res) => {
    const { licenseKey } = req.body;

    const license = await activateLicense(licenseKey, req.user!.organizationId);

    res.json({
      success: true,
      data: license,
      message: 'Licenza attivata con successo',
    });
  })
);

// Rinnova licenza (solo admin) - endpoint per integrazione pagamenti
router.post(
  '/renew',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { additionalDays } = req.body;

    if (!additionalDays || typeof additionalDays !== 'number' || additionalDays < 1) {
      res.status(400).json({
        success: false,
        error: 'additionalDays deve essere un numero positivo',
        code: 'INVALID_INPUT',
      });
      return;
    }

    const license = await renewLicense(req.user!.organizationId, additionalDays);

    res.json({
      success: true,
      data: license,
      message: `Licenza rinnovata per ${additionalDays} giorni`,
    });
  })
);

// Upgrade piano (solo admin)
router.post(
  '/upgrade',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { newPlan } = req.body;

    const validPlans = ['BASE', 'TEAM', 'BUSINESS', 'ENTERPRISE'];
    if (!newPlan || !validPlans.includes(newPlan)) {
      res.status(400).json({
        success: false,
        error: `Piano non valido. Valori ammessi: ${validPlans.join(', ')}`,
        code: 'INVALID_PLAN',
      });
      return;
    }

    const license = await upgradeLicense(req.user!.organizationId, newPlan);

    res.json({
      success: true,
      data: license,
      message: `Piano aggiornato a ${newPlan}`,
    });
  })
);

export default router;
