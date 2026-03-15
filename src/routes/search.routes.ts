// Routes Ricerca per DocuVault

import { Router } from 'express';
import {
  searchController,
  advancedSearchController,
  suggestionsController,
  recentController,
  expiringController,
} from '../controllers/search.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requireValidLicense, requireFeature } from '../middleware/license.middleware.js';

const router = Router();

// Middleware autenticazione e licenza su tutte le routes
router.use(authenticate);
router.use(requireValidLicense);

// Ricerca base
router.get('/', searchController);

// Ricerca avanzata (richiede feature)
router.post('/advanced', requireFeature('advanced_search'), advancedSearchController);

// Suggerimenti autocomplete
router.get('/suggestions', suggestionsController);

// Documenti recenti
router.get('/recent', recentController);

// Documenti in scadenza
router.get('/expiring', expiringController);

export default router;
