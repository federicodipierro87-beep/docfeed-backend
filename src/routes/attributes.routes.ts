// Routes Attributi Metadata per DocuVault

import { Router } from 'express';
import { prisma } from '../services/prisma.service.js';
import { authenticate, requireManager, requireAdmin } from '../middleware/auth.middleware.js';
import { requireValidLicense, requireFeature } from '../middleware/license.middleware.js';
import { asyncHandler } from '../middleware/error.middleware.js';
import { NotFoundError, ConflictError } from '../types/index.js';

const router = Router();

// Middleware
router.use(authenticate);
router.use(requireValidLicense);
router.use(requireFeature('custom_metadata'));

// === ATTRIBUTI ===

// Lista attributi
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const attributes = await prisma.metadataAttribute.findMany({
      where: { organizationId: req.user!.organizationId },
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { classAttributes: true } },
      },
    });

    res.json({ success: true, data: attributes });
  })
);

// Crea attributo
router.post(
  '/',
  requireManager,
  asyncHandler(async (req, res) => {
    const { name, label, type, isRequired, isSearchable, defaultValue, options } = req.body;

    if (!name || !label || !type) {
      res.status(400).json({
        success: false,
        error: 'Nome, etichetta e tipo sono obbligatori',
        code: 'VALIDATION_ERROR',
      });
      return;
    }

    // Verifica nome unico
    const existing = await prisma.metadataAttribute.findFirst({
      where: {
        organizationId: req.user!.organizationId,
        name,
      },
    });

    if (existing) {
      throw new ConflictError('Attributo con questo nome già esistente');
    }

    const attribute = await prisma.metadataAttribute.create({
      data: {
        name,
        label,
        type,
        isRequired: isRequired || false,
        isSearchable: isSearchable !== false,
        defaultValue,
        options: options ? JSON.stringify(options) : null,
        organizationId: req.user!.organizationId,
      },
    });

    res.status(201).json({ success: true, data: attribute });
  })
);

// Dettaglio attributo
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const attribute = await prisma.metadataAttribute.findFirst({
      where: {
        id: req.params.id,
        organizationId: req.user!.organizationId,
      },
      include: {
        classAttributes: {
          include: {
            class: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!attribute) {
      throw new NotFoundError('Attributo');
    }

    res.json({ success: true, data: attribute });
  })
);

// Aggiorna attributo
router.patch(
  '/:id',
  requireManager,
  asyncHandler(async (req, res) => {
    const { label, isRequired, isSearchable, defaultValue, options } = req.body;

    const attribute = await prisma.metadataAttribute.findFirst({
      where: {
        id: req.params.id,
        organizationId: req.user!.organizationId,
      },
    });

    if (!attribute) {
      throw new NotFoundError('Attributo');
    }

    const updated = await prisma.metadataAttribute.update({
      where: { id: req.params.id },
      data: {
        ...(label && { label }),
        ...(isRequired !== undefined && { isRequired }),
        ...(isSearchable !== undefined && { isSearchable }),
        ...(defaultValue !== undefined && { defaultValue }),
        ...(options !== undefined && { options: options ? JSON.stringify(options) : null }),
      },
    });

    res.json({ success: true, data: updated });
  })
);

// Elimina attributo
router.delete(
  '/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const attribute = await prisma.metadataAttribute.findFirst({
      where: {
        id: req.params.id,
        organizationId: req.user!.organizationId,
      },
      include: {
        _count: { select: { classAttributes: true } },
      },
    });

    if (!attribute) {
      throw new NotFoundError('Attributo');
    }

    // Elimina anche le associazioni con le classi
    await prisma.metadataClassAttribute.deleteMany({
      where: { attributeId: req.params.id },
    });

    await prisma.metadataAttribute.delete({ where: { id: req.params.id } });

    res.json({ success: true, message: 'Attributo eliminato' });
  })
);

export default router;
