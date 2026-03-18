// Routes Gruppi Utenti per DocuVault

import { Router } from 'express';
import {
  listGroupsController,
  getGroupController,
  createGroupController,
  updateGroupController,
  deleteGroupController,
  addMemberController,
  removeMemberController,
} from '../controllers/userGroup.controller.js';
import { authenticate, requireManager } from '../middleware/auth.middleware.js';
import { requireValidLicense } from '../middleware/license.middleware.js';

const router = Router();

// Middleware autenticazione e licenza su tutte le routes
router.use(authenticate);
router.use(requireValidLicense);

// CRUD Gruppi (solo admin/manager)
router.get('/', listGroupsController);
router.get('/:id', getGroupController);
router.post('/', requireManager, createGroupController);
router.patch('/:id', requireManager, updateGroupController);
router.delete('/:id', requireManager, deleteGroupController);

// Gestione membri
router.post('/:id/members', requireManager, addMemberController);
router.delete('/:id/members/:userId', requireManager, removeMemberController);

export default router;
