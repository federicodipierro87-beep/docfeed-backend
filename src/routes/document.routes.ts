// Routes Documenti per DocuVault

import { Router } from 'express';
import {
  createDocumentController,
  listDocumentsController,
  getDocumentController,
  updateDocumentController,
  deleteDocumentController,
  restoreDocumentController,
  permanentDeleteController,
  createVersionController,
  listVersionsController,
  checkoutController,
  checkinController,
  downloadController,
  getTransitionsController,
  transitionController,
  getAuditController,
  listTrashController,
} from '../controllers/document.controller.js';
import { authenticate, requireManager, requireAdmin } from '../middleware/auth.middleware.js';
import { requireValidLicense, checkStorageLimitMiddleware } from '../middleware/license.middleware.js';
import { uploadSingle, requireFile, handleUploadError } from '../middleware/upload.middleware.js';

const router = Router();

// Middleware autenticazione e licenza su tutte le routes
router.use(authenticate);
router.use(requireValidLicense);

// Cestino
router.get('/trash', requireManager, listTrashController);

// CRUD Documenti
router.post(
  '/',
  uploadSingle('file'),
  handleUploadError,
  requireFile,
  checkStorageLimitMiddleware(),
  createDocumentController
);

router.get('/', listDocumentsController);

router.get('/:id', getDocumentController);

router.patch('/:id', updateDocumentController);

router.delete('/:id', deleteDocumentController);

// Ripristino e eliminazione permanente
router.post('/:id/restore', requireManager, restoreDocumentController);

router.delete('/:id/permanent', requireAdmin, permanentDeleteController);

// Versioning
router.post(
  '/:id/versions',
  uploadSingle('file'),
  handleUploadError,
  requireFile,
  checkStorageLimitMiddleware(),
  createVersionController
);

router.get('/:id/versions', listVersionsController);

// Checkout / Checkin
router.post('/:id/checkout', checkoutController);

router.post(
  '/:id/checkin',
  uploadSingle('file'),
  handleUploadError,
  checkinController
);

// Download
router.get('/:id/download', downloadController);

// Workflow
router.get('/:id/transitions', getTransitionsController);

router.post('/:id/transition', transitionController);

// Audit
router.get('/:id/audit', getAuditController);

export default router;
