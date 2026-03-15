// Routes Audit Log per DocuVault

import { Router } from 'express';
import { getAuditLogs, getAuditStats, exportAuditLogs } from '../services/audit.service.js';
import { authenticate, requireManager, requireAdmin } from '../middleware/auth.middleware.js';
import { requireValidLicense, requireFeature } from '../middleware/license.middleware.js';
import { asyncHandler } from '../middleware/error.middleware.js';
import { JwtPayload } from '../types/index.js';
import { AuditAction } from '@prisma/client';

const router = Router();

// Middleware
router.use(authenticate);
router.use(requireValidLicense);
router.use(requireFeature('audit_log'));
router.use(requireManager);

// Lista audit logs
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const {
      userId,
      documentId,
      action,
      entityType,
      startDate,
      endDate,
      cursor,
      limit,
    } = req.query;

    const result = await getAuditLogs(
      {
        userId: userId as string,
        documentId: documentId as string,
        action: action as AuditAction,
        entityType: entityType as string,
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined,
      },
      {
        cursor: cursor as string,
        limit: limit ? parseInt(limit as string) : undefined,
      },
      req.user as JwtPayload
    );

    res.json({ success: true, data: result });
  })
);

// Statistiche audit
router.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const { days } = req.query;

    const stats = await getAuditStats(
      req.user as JwtPayload,
      days ? parseInt(days as string) : undefined
    );

    res.json({ success: true, data: stats });
  })
);

// Export audit logs (solo admin)
router.get(
  '/export',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const {
      userId,
      documentId,
      action,
      entityType,
      startDate,
      endDate,
      format,
    } = req.query;

    const exportData = await exportAuditLogs(
      {
        userId: userId as string,
        documentId: documentId as string,
        action: action as AuditAction,
        entityType: entityType as string,
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined,
      },
      req.user as JwtPayload,
      (format as 'json' | 'csv') || 'json'
    );

    const contentType = format === 'csv' ? 'text/csv' : 'application/json';
    const extension = format === 'csv' ? 'csv' : 'json';
    const filename = `audit_export_${new Date().toISOString().split('T')[0]}.${extension}`;

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(exportData);
  })
);

// Azioni disponibili (per filtri UI)
router.get(
  '/actions',
  asyncHandler(async (req, res) => {
    const actions = Object.values(AuditAction);

    res.json({
      success: true,
      data: actions.map((action) => ({
        value: action,
        label: formatActionLabel(action),
      })),
    });
  })
);

function formatActionLabel(action: AuditAction): string {
  const labels: Record<AuditAction, string> = {
    VIEW: 'Visualizzazione',
    DOWNLOAD: 'Download',
    CREATE: 'Creazione',
    EDIT: 'Modifica',
    DELETE: 'Eliminazione',
    RESTORE: 'Ripristino',
    CHECKIN: 'Check-in',
    CHECKOUT: 'Check-out',
    SHARE: 'Condivisione',
    PERMISSION_CHANGE: 'Modifica permessi',
    WORKFLOW_CHANGE: 'Cambio stato workflow',
    METADATA_CHANGE: 'Modifica metadata',
    VERSION_CREATE: 'Nuova versione',
    LOGIN: 'Login',
    LOGOUT: 'Logout',
  };

  return labels[action] || action;
}

export default router;
