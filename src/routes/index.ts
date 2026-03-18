// Router principale per DocuVault API

import { Router } from 'express';
import authRoutes from './auth.routes.js';
import documentRoutes from './document.routes.js';
import vaultRoutes from './vault.routes.js';
import searchRoutes from './search.routes.js';
import workflowRoutes from './workflow.routes.js';
import metadataRoutes from './metadata.routes.js';
import attributeRoutes from './attributes.routes.js';
import tagRoutes from './tag.routes.js';
import userRoutes from './user.routes.js';
import userGroupRoutes from './userGroup.routes.js';
import savedViewRoutes from './savedView.routes.js';
import licenseRoutes from './license.routes.js';
import auditRoutes from './audit.routes.js';
import retentionRoutes from './retention.routes.js';

const router = Router();

// Health check
router.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
  });
});

// Routes
router.use('/auth', authRoutes);
router.use('/documents', documentRoutes);
router.use('/vaults', vaultRoutes);
router.use('/search', searchRoutes);
router.use('/workflows', workflowRoutes);
router.use('/metadata', metadataRoutes);
router.use('/attributes', attributeRoutes);
router.use('/tags', tagRoutes);
router.use('/users', userRoutes);
router.use('/user-groups', userGroupRoutes);
router.use('/views', savedViewRoutes);
router.use('/license', licenseRoutes);
router.use('/audit', auditRoutes);
router.use('/retention', retentionRoutes);

export default router;
