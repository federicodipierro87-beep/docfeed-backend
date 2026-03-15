// Routes Tag per DocuVault

import { Router } from 'express';
import { prisma } from '../services/prisma.service.js';
import { authenticate, requireManager } from '../middleware/auth.middleware.js';
import { requireValidLicense } from '../middleware/license.middleware.js';
import { asyncHandler, validateBody } from '../middleware/error.middleware.js';
import { createTagSchema } from '../utils/validation.js';
import { NotFoundError, ConflictError } from '../types/index.js';

const router = Router();

// Middleware
router.use(authenticate);
router.use(requireValidLicense);

// Lista tags
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const tags = await prisma.tag.findMany({
      where: { organizationId: req.user!.organizationId },
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { documents: true } },
      },
    });

    res.json({ success: true, data: tags });
  })
);

// Crea tag
router.post(
  '/',
  requireManager,
  validateBody(createTagSchema),
  asyncHandler(async (req, res) => {
    const { name, color } = req.body;

    // Verifica nome unico
    const existing = await prisma.tag.findFirst({
      where: {
        organizationId: req.user!.organizationId,
        name,
      },
    });

    if (existing) {
      throw new ConflictError('Tag con questo nome già esistente');
    }

    const tag = await prisma.tag.create({
      data: {
        name,
        color: color || '#6366f1',
        organizationId: req.user!.organizationId,
      },
    });

    res.status(201).json({ success: true, data: tag });
  })
);

// Dettaglio tag con documenti
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const tag = await prisma.tag.findFirst({
      where: {
        id: req.params.id,
        organizationId: req.user!.organizationId,
      },
      include: {
        documents: {
          include: {
            document: {
              select: {
                id: true,
                name: true,
                mimeType: true,
                status: true,
                vault: { select: { id: true, name: true } },
              },
            },
          },
          take: 50,
        },
        _count: { select: { documents: true } },
      },
    });

    if (!tag) {
      throw new NotFoundError('Tag');
    }

    res.json({
      success: true,
      data: {
        ...tag,
        documents: tag.documents.map((dt) => dt.document),
      },
    });
  })
);

// Aggiorna tag
router.patch(
  '/:id',
  requireManager,
  asyncHandler(async (req, res) => {
    const { name, color } = req.body;

    const tag = await prisma.tag.findFirst({
      where: {
        id: req.params.id,
        organizationId: req.user!.organizationId,
      },
    });

    if (!tag) {
      throw new NotFoundError('Tag');
    }

    // Verifica nome unico se cambiato
    if (name && name !== tag.name) {
      const existing = await prisma.tag.findFirst({
        where: {
          organizationId: req.user!.organizationId,
          name,
          id: { not: req.params.id },
        },
      });

      if (existing) {
        throw new ConflictError('Tag con questo nome già esistente');
      }
    }

    const updated = await prisma.tag.update({
      where: { id: req.params.id },
      data: {
        ...(name && { name }),
        ...(color && { color }),
      },
    });

    res.json({ success: true, data: updated });
  })
);

// Elimina tag
router.delete(
  '/:id',
  requireManager,
  asyncHandler(async (req, res) => {
    const tag = await prisma.tag.findFirst({
      where: {
        id: req.params.id,
        organizationId: req.user!.organizationId,
      },
    });

    if (!tag) {
      throw new NotFoundError('Tag');
    }

    // Elimina associazioni prima
    await prisma.documentTag.deleteMany({
      where: { tagId: req.params.id },
    });

    await prisma.tag.delete({ where: { id: req.params.id } });

    res.json({ success: true, message: 'Tag eliminato' });
  })
);

export default router;
