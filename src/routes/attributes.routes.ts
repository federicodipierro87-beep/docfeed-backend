// Routes Attributi Metadata per DocuVault

import { Router } from 'express';
import { Prisma } from '@prisma/client';
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

// Helper: verifica se l'utente può vedere l'attributo/classe
function canUserAccess(
  item: { isPublic: boolean; allowedRoles?: any; allowedUserIds?: any },
  user: { userId: string; role: string }
): boolean {
  // Se pubblico, tutti possono vedere
  if (item.isPublic) return true;

  // Admin e Manager vedono tutto
  if (user.role === 'ADMIN' || user.role === 'MANAGER') return true;

  // Controlla ruoli permessi
  if (item.allowedRoles) {
    const roles = typeof item.allowedRoles === 'string'
      ? JSON.parse(item.allowedRoles)
      : item.allowedRoles;
    if (Array.isArray(roles) && roles.includes(user.role)) return true;
  }

  // Controlla user ID specifici
  if (item.allowedUserIds) {
    const userIds = typeof item.allowedUserIds === 'string'
      ? JSON.parse(item.allowedUserIds)
      : item.allowedUserIds;
    if (Array.isArray(userIds) && userIds.includes(user.userId)) return true;
  }

  return false;
}

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

    // Filtra in base ai permessi
    const filtered = attributes.filter(attr =>
      canUserAccess(attr, { userId: req.user!.userId, role: req.user!.role })
    );

    res.json({ success: true, data: filtered });
  })
);

// Crea attributo
router.post(
  '/',
  requireManager,
  asyncHandler(async (req, res) => {
    const {
      name, label, type, isRequired, isSearchable, defaultValue, options,
      isPublic, allowedRoles, allowedUserIds
    } = req.body;

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
        options: options ? JSON.stringify(options) : undefined,
        isPublic: isPublic !== false,
        allowedRoles: allowedRoles ? JSON.stringify(allowedRoles) : undefined,
        allowedUserIds: allowedUserIds ? JSON.stringify(allowedUserIds) : undefined,
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
    const { label, isRequired, isSearchable, defaultValue, options, isPublic, allowedRoles, allowedUserIds } = req.body;

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
        ...(options !== undefined && { options: options ? JSON.stringify(options) : Prisma.JsonNull }),
        ...(isPublic !== undefined && { isPublic }),
        ...(allowedRoles !== undefined && { allowedRoles: allowedRoles ? JSON.stringify(allowedRoles) : Prisma.JsonNull }),
        ...(allowedUserIds !== undefined && { allowedUserIds: allowedUserIds ? JSON.stringify(allowedUserIds) : Prisma.JsonNull }),
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
