// Routes Viste Salvate per DocuVault

import { Router } from 'express';
import {
  listViewsController,
  getViewController,
  executeViewController,
  createViewController,
  updateViewController,
  deleteViewController,
} from '../controllers/savedView.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requireValidLicense } from '../middleware/license.middleware.js';

const router = Router();

// Middleware autenticazione e licenza
router.use(authenticate);
router.use(requireValidLicense);

// CRUD Viste
router.get('/', listViewsController);
router.get('/:id', getViewController);
router.get('/:id/execute', executeViewController);
router.post('/', createViewController);
router.patch('/:id', updateViewController);
router.delete('/:id', deleteViewController);

export default router;
