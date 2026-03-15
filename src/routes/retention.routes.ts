// Routes Retention Policies per DocuVault

import { Router } from 'express';
import {
  createRetentionPolicy,
  getRetentionPolicy,
  listRetentionPolicies,
  updateRetentionPolicy,
  deleteRetentionPolicy,
  applyRetentionPolicy,
  removeRetentionPolicy,
  getRetentionStats,
  getExpiringDocuments,
  triggerRetentionCheck,
} from '../services/retention.service.js';
import { authenticate, requireManager, requireAdmin } from '../middleware/auth.middleware.js';
import { requireValidLicense, requireFeature } from '../middleware/license.middleware.js';
import { asyncHandler, validateBody } from '../middleware/error.middleware.js';
import { createRetentionPolicySchema } from '../utils/validation.js';
import { JwtPayload } from '../types/index.js';

const router = Router();

// Middleware
router.use(authenticate);
router.use(requireValidLicense);
router.use(requireFeature('retention'));

// Lista policies
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const policies = await listRetentionPolicies(req.user as JwtPayload);
    res.json({ success: true, data: policies });
  })
);

// Statistiche
router.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const stats = await getRetentionStats(req.user as JwtPayload);
    res.json({ success: true, data: stats });
  })
);

// Documenti in scadenza
router.get(
  '/expiring',
  asyncHandler(async (req, res) => {
    const { days } = req.query;
    const documents = await getExpiringDocuments(
      days ? parseInt(days as string) : 30,
      req.user as JwtPayload
    );
    res.json({ success: true, data: documents });
  })
);

// Crea policy
router.post(
  '/',
  requireManager,
  validateBody(createRetentionPolicySchema),
  asyncHandler(async (req, res) => {
    const policy = await createRetentionPolicy(req.body, req.user as JwtPayload);
    res.status(201).json({ success: true, data: policy });
  })
);

// Dettaglio policy
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const policy = await getRetentionPolicy(req.params.id, req.user as JwtPayload);
    res.json({ success: true, data: policy });
  })
);

// Aggiorna policy
router.patch(
  '/:id',
  requireManager,
  asyncHandler(async (req, res) => {
    const policy = await updateRetentionPolicy(req.params.id, req.body, req.user as JwtPayload);
    res.json({ success: true, data: policy });
  })
);

// Elimina policy
router.delete(
  '/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    await deleteRetentionPolicy(req.params.id, req.user as JwtPayload);
    res.json({ success: true, message: 'Policy eliminata' });
  })
);

// Applica policy a documento
router.post(
  '/:id/apply/:documentId',
  requireManager,
  asyncHandler(async (req, res) => {
    await applyRetentionPolicy(req.params.documentId, req.params.id, req.user as JwtPayload);
    res.json({ success: true, message: 'Policy applicata' });
  })
);

// Rimuovi policy da documento
router.delete(
  '/documents/:documentId',
  requireManager,
  asyncHandler(async (req, res) => {
    await removeRetentionPolicy(req.params.documentId, req.user as JwtPayload);
    res.json({ success: true, message: 'Policy rimossa' });
  })
);

// Trigger manuale check retention (solo admin)
router.post(
  '/check',
  requireAdmin,
  asyncHandler(async (req, res) => {
    await triggerRetentionCheck();
    res.json({ success: true, message: 'Check retention accodato' });
  })
);

export default router;
