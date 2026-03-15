// Routes Workflow per DocuVault

import { Router } from 'express';
import { prisma } from '../services/prisma.service.js';
import {
  createWorkflow,
  getWorkflow,
  listWorkflows,
  updateWorkflow,
  deleteWorkflow,
  createWorkflowState,
  updateWorkflowState,
  deleteWorkflowState,
  createWorkflowTransition,
  deleteWorkflowTransition,
  getDocumentsByWorkflowState,
} from '../services/workflow.service.js';
import { authenticate, requireManager, requireAdmin } from '../middleware/auth.middleware.js';
import { requireValidLicense, requireFeature } from '../middleware/license.middleware.js';
import { asyncHandler, validateBody } from '../middleware/error.middleware.js';
import {
  createWorkflowSchema,
  createWorkflowStateSchema,
  createWorkflowTransitionSchema,
} from '../utils/validation.js';
import { JwtPayload } from '../types/index.js';

const router = Router();

// Middleware
router.use(authenticate);
router.use(requireValidLicense);
router.use(requireFeature('workflow'));

// === WORKFLOW CRUD ===

// Lista workflows
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const workflows = await listWorkflows(req.user as JwtPayload);
    res.json({ success: true, data: workflows });
  })
);

// Crea workflow
router.post(
  '/',
  requireManager,
  validateBody(createWorkflowSchema),
  asyncHandler(async (req, res) => {
    const workflow = await createWorkflow(req.body, req.user as JwtPayload);
    res.status(201).json({ success: true, data: workflow });
  })
);

// Dettaglio workflow
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const workflow = await getWorkflow(req.params.id, req.user as JwtPayload);
    res.json({ success: true, data: workflow });
  })
);

// Aggiorna workflow
router.patch(
  '/:id',
  requireManager,
  asyncHandler(async (req, res) => {
    const workflow = await updateWorkflow(req.params.id, req.body, req.user as JwtPayload);
    res.json({ success: true, data: workflow });
  })
);

// Elimina workflow
router.delete(
  '/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    await deleteWorkflow(req.params.id, req.user as JwtPayload);
    res.json({ success: true, message: 'Workflow eliminato' });
  })
);

// === STATI WORKFLOW ===

// Crea stato
router.post(
  '/:id/states',
  requireManager,
  validateBody(createWorkflowStateSchema),
  asyncHandler(async (req, res) => {
    const state = await createWorkflowState(req.params.id, req.body, req.user as JwtPayload);
    res.status(201).json({ success: true, data: state });
  })
);

// Aggiorna stato
router.patch(
  '/:workflowId/states/:stateId',
  requireManager,
  asyncHandler(async (req, res) => {
    const state = await updateWorkflowState(req.params.stateId, req.body, req.user as JwtPayload);
    res.json({ success: true, data: state });
  })
);

// Elimina stato
router.delete(
  '/:workflowId/states/:stateId',
  requireAdmin,
  asyncHandler(async (req, res) => {
    await deleteWorkflowState(req.params.stateId, req.user as JwtPayload);
    res.json({ success: true, message: 'Stato eliminato' });
  })
);

// Documenti per stato
router.get(
  '/:id/states/:stateId?/documents',
  asyncHandler(async (req, res) => {
    const result = await getDocumentsByWorkflowState(
      req.params.id,
      req.params.stateId,
      req.user as JwtPayload
    );
    res.json({ success: true, data: result });
  })
);

// === TRANSIZIONI ===

// Crea transizione
router.post(
  '/:id/transitions',
  requireManager,
  validateBody(createWorkflowTransitionSchema),
  asyncHandler(async (req, res) => {
    const transition = await createWorkflowTransition(req.params.id, req.body, req.user as JwtPayload);
    res.status(201).json({ success: true, data: transition });
  })
);

// Elimina transizione
router.delete(
  '/:workflowId/transitions/:transitionId',
  requireAdmin,
  asyncHandler(async (req, res) => {
    await deleteWorkflowTransition(req.params.transitionId, req.user as JwtPayload);
    res.json({ success: true, message: 'Transizione eliminata' });
  })
);

export default router;
