// Routes Vault per DocuVault

import { Router } from 'express';
import {
  createVaultController,
  listVaultsController,
  getVaultController,
  updateVaultController,
  deleteVaultController,
  getVaultStatsController,
  listVaultMembersController,
  addVaultMemberController,
  updateVaultMemberController,
  removeVaultMemberController,
} from '../controllers/vault.controller.js';
import { authenticate, requireManager, requireAdmin } from '../middleware/auth.middleware.js';
import { requireValidLicense } from '../middleware/license.middleware.js';
import { validateBody } from '../middleware/error.middleware.js';
import { createVaultSchema, updateVaultSchema } from '../utils/validation.js';

const router = Router();

// Middleware autenticazione e licenza su tutte le routes
router.use(authenticate);
router.use(requireValidLicense);

// Lista vault
router.get('/', listVaultsController);

// Dettaglio vault
router.get('/:id', getVaultController);

// Statistiche vault
router.get('/:id/stats', getVaultStatsController);

// Creazione vault (manager+)
router.post('/', requireManager, validateBody(createVaultSchema), createVaultController);

// Aggiornamento vault (manager+)
router.patch('/:id', requireManager, validateBody(updateVaultSchema), updateVaultController);

// Eliminazione vault (admin)
router.delete('/:id', requireAdmin, deleteVaultController);

// Membri vault (admin)
router.get('/:id/members', requireAdmin, listVaultMembersController);
router.post('/:id/members', requireAdmin, addVaultMemberController);
router.patch('/:id/members/:userId', requireAdmin, updateVaultMemberController);
router.delete('/:id/members/:userId', requireAdmin, removeVaultMemberController);

export default router;
