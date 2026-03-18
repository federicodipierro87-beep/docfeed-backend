// Routes Metadata per DocuVault

import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../services/prisma.service.js';
import { authenticate, requireManager, requireAdmin } from '../middleware/auth.middleware.js';
import { requireValidLicense, requireFeature } from '../middleware/license.middleware.js';
import { asyncHandler, validateBody } from '../middleware/error.middleware.js';
import {
  createMetadataClassSchema,
  createMetadataFieldSchema,
  updateMetadataFieldSchema,
} from '../utils/validation.js';
import { NotFoundError, ConflictError } from '../types/index.js';

const router = Router();

// Middleware
router.use(authenticate);
router.use(requireValidLicense);
router.use(requireFeature('custom_metadata'));

// Helper: verifica se l'utente può vedere la classe
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

// === CLASSI METADATA ===

// Lista classi
router.get(
  '/classes',
  asyncHandler(async (req, res) => {
    const classes = await prisma.metadataClass.findMany({
      where: { organizationId: req.user!.organizationId },
      orderBy: { name: 'asc' },
      include: {
        vault: { select: { id: true, name: true } },
        parent: { select: { id: true, name: true } },
        children: { select: { id: true, name: true } },
        fields: { orderBy: { order: 'asc' } },
        classAttributes: {
          orderBy: { order: 'asc' },
          include: {
            attribute: true,
          },
        },
        _count: { select: { vaultsUsingThis: true, children: true } },
      },
    });

    // Filtra in base ai permessi
    const filtered = classes.filter(cls =>
      canUserAccess(cls, { userId: req.user!.userId, role: req.user!.role })
    );

    res.json({ success: true, data: filtered });
  })
);

// Crea classe
router.post(
  '/classes',
  requireManager,
  validateBody(createMetadataClassSchema),
  asyncHandler(async (req, res) => {
    const { name, description, parentId, vaultId, isPublic, allowedRoles, allowedUserIds } = req.body;

    // Verifica nome unico
    const existing = await prisma.metadataClass.findFirst({
      where: {
        organizationId: req.user!.organizationId,
        name,
      },
    });

    if (existing) {
      throw new ConflictError('Classe metadata con questo nome già esistente');
    }

    // Verifica che il parent esista se specificato
    if (parentId) {
      const parent = await prisma.metadataClass.findFirst({
        where: {
          id: parentId,
          organizationId: req.user!.organizationId,
        },
      });

      if (!parent) {
        throw new NotFoundError('Classe padre');
      }
    }

    // Verifica che il vault esista se specificato
    if (vaultId) {
      const vault = await prisma.vault.findFirst({
        where: {
          id: vaultId,
          organizationId: req.user!.organizationId,
        },
      });

      if (!vault) {
        throw new NotFoundError('Vault');
      }
    }

    const metadataClass = await prisma.metadataClass.create({
      data: {
        name,
        description,
        parentId: parentId || null,
        vaultId: vaultId || null,
        isPublic: isPublic !== false,
        allowedRoles: allowedRoles ? JSON.stringify(allowedRoles) : undefined,
        allowedUserIds: allowedUserIds ? JSON.stringify(allowedUserIds) : undefined,
        organizationId: req.user!.organizationId,
      },
      include: {
        vault: { select: { id: true, name: true } },
        parent: { select: { id: true, name: true } },
      },
    });

    res.status(201).json({ success: true, data: metadataClass });
  })
);

// Dettaglio classe
router.get(
  '/classes/:id',
  asyncHandler(async (req, res) => {
    const metadataClass = await prisma.metadataClass.findFirst({
      where: {
        id: req.params.id,
        organizationId: req.user!.organizationId,
      },
      include: {
        vault: { select: { id: true, name: true } },
        parent: { select: { id: true, name: true } },
        children: {
          select: { id: true, name: true, description: true },
          orderBy: { name: 'asc' },
        },
        fields: { orderBy: { order: 'asc' } },
        classAttributes: {
          orderBy: { order: 'asc' },
          include: {
            attribute: true,
          },
        },
        vaultsUsingThis: { select: { id: true, name: true } },
      },
    });

    if (!metadataClass) {
      throw new NotFoundError('Classe metadata');
    }

    res.json({ success: true, data: metadataClass });
  })
);

// Aggiorna classe
router.patch(
  '/classes/:id',
  requireManager,
  asyncHandler(async (req, res) => {
    const { name, description, parentId, vaultId, isPublic, allowedRoles, allowedUserIds } = req.body;

    const metadataClass = await prisma.metadataClass.findFirst({
      where: {
        id: req.params.id,
        organizationId: req.user!.organizationId,
      },
    });

    if (!metadataClass) {
      throw new NotFoundError('Classe metadata');
    }

    // Verifica nome unico se cambiato
    if (name && name !== metadataClass.name) {
      const existing = await prisma.metadataClass.findFirst({
        where: {
          organizationId: req.user!.organizationId,
          name,
          id: { not: req.params.id },
        },
      });

      if (existing) {
        throw new ConflictError('Classe metadata con questo nome già esistente');
      }
    }

    // Verifica che il parent esista e non sia se stesso o un figlio
    if (parentId !== undefined && parentId !== null) {
      if (parentId === req.params.id) {
        throw new ConflictError('Una classe non può essere padre di se stessa');
      }

      const parent = await prisma.metadataClass.findFirst({
        where: {
          id: parentId,
          organizationId: req.user!.organizationId,
        },
      });

      if (!parent) {
        throw new NotFoundError('Classe padre');
      }

      // Verifica che il parent non sia un figlio di questa classe (evita cicli)
      const children = await prisma.metadataClass.findMany({
        where: { parentId: req.params.id },
        select: { id: true },
      });

      if (children.some(c => c.id === parentId)) {
        throw new ConflictError('Non puoi impostare un figlio come padre');
      }
    }

    // Verifica che il vault esista se specificato
    if (vaultId !== undefined && vaultId !== null) {
      const vault = await prisma.vault.findFirst({
        where: {
          id: vaultId,
          organizationId: req.user!.organizationId,
        },
      });

      if (!vault) {
        throw new NotFoundError('Vault');
      }
    }

    const updated = await prisma.metadataClass.update({
      where: { id: req.params.id },
      data: {
        ...(name && { name }),
        ...(description !== undefined && { description }),
        ...(parentId !== undefined && { parentId: parentId || null }),
        ...(vaultId !== undefined && { vaultId: vaultId || null }),
        ...(isPublic !== undefined && { isPublic }),
        ...(allowedRoles !== undefined && { allowedRoles: allowedRoles ? JSON.stringify(allowedRoles) : Prisma.JsonNull }),
        ...(allowedUserIds !== undefined && { allowedUserIds: allowedUserIds ? JSON.stringify(allowedUserIds) : Prisma.JsonNull }),
      },
      include: {
        vault: { select: { id: true, name: true } },
        parent: { select: { id: true, name: true } },
      },
    });

    res.json({ success: true, data: updated });
  })
);

// Elimina classe
router.delete(
  '/classes/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const metadataClass = await prisma.metadataClass.findFirst({
      where: {
        id: req.params.id,
        organizationId: req.user!.organizationId,
      },
      include: {
        _count: { select: { vaultsUsingThis: true } },
      },
    });

    if (!metadataClass) {
      throw new NotFoundError('Classe metadata');
    }

    if (metadataClass._count.vaultsUsingThis > 0) {
      throw new ConflictError('Impossibile eliminare classe con vault associati');
    }

    await prisma.metadataClass.delete({ where: { id: req.params.id } });

    res.json({ success: true, message: 'Classe eliminata' });
  })
);

// === ATTRIBUTI CLASSE ===

// Aggiungi attributo a classe
router.post(
  '/classes/:classId/attributes',
  requireManager,
  asyncHandler(async (req, res) => {
    const { attributeId, isRequired, order } = req.body;

    const metadataClass = await prisma.metadataClass.findFirst({
      where: {
        id: req.params.classId,
        organizationId: req.user!.organizationId,
      },
    });

    if (!metadataClass) {
      throw new NotFoundError('Classe metadata');
    }

    // Verifica che l'attributo esista
    const attribute = await prisma.metadataAttribute.findFirst({
      where: {
        id: attributeId,
        organizationId: req.user!.organizationId,
      },
    });

    if (!attribute) {
      throw new NotFoundError('Attributo');
    }

    // Verifica se già associato
    const existing = await prisma.metadataClassAttribute.findFirst({
      where: {
        classId: req.params.classId,
        attributeId,
      },
    });

    if (existing) {
      throw new ConflictError('Attributo già associato a questa classe');
    }

    // Calcola ordine se non specificato
    let newOrder = order;
    if (newOrder === undefined) {
      const lastAttr = await prisma.metadataClassAttribute.findFirst({
        where: { classId: req.params.classId },
        orderBy: { order: 'desc' },
      });
      newOrder = lastAttr ? lastAttr.order + 1 : 0;
    }

    const classAttribute = await prisma.metadataClassAttribute.create({
      data: {
        classId: req.params.classId,
        attributeId,
        isRequired: isRequired || false,
        order: newOrder,
      },
      include: {
        attribute: true,
      },
    });

    res.status(201).json({ success: true, data: classAttribute });
  })
);

// Rimuovi attributo da classe
router.delete(
  '/classes/:classId/attributes/:attributeId',
  requireManager,
  asyncHandler(async (req, res) => {
    const classAttribute = await prisma.metadataClassAttribute.findFirst({
      where: {
        classId: req.params.classId,
        attributeId: req.params.attributeId,
      },
      include: {
        class: true,
      },
    });

    if (!classAttribute || classAttribute.class.organizationId !== req.user!.organizationId) {
      throw new NotFoundError('Associazione attributo-classe');
    }

    await prisma.metadataClassAttribute.delete({
      where: { id: classAttribute.id },
    });

    res.json({ success: true, message: 'Attributo rimosso dalla classe' });
  })
);

// Aggiorna attributo in classe (ordine, obbligatorietà)
router.patch(
  '/classes/:classId/attributes/:attributeId',
  requireManager,
  asyncHandler(async (req, res) => {
    const { isRequired, order } = req.body;

    const classAttribute = await prisma.metadataClassAttribute.findFirst({
      where: {
        classId: req.params.classId,
        attributeId: req.params.attributeId,
      },
      include: {
        class: true,
      },
    });

    if (!classAttribute || classAttribute.class.organizationId !== req.user!.organizationId) {
      throw new NotFoundError('Associazione attributo-classe');
    }

    const updated = await prisma.metadataClassAttribute.update({
      where: { id: classAttribute.id },
      data: {
        ...(isRequired !== undefined && { isRequired }),
        ...(order !== undefined && { order }),
      },
      include: {
        attribute: true,
      },
    });

    res.json({ success: true, data: updated });
  })
);

// === CAMPI METADATA (legacy) ===

// Aggiungi campo a classe
router.post(
  '/classes/:classId/fields',
  requireManager,
  validateBody(createMetadataFieldSchema),
  asyncHandler(async (req, res) => {
    const metadataClass = await prisma.metadataClass.findFirst({
      where: {
        id: req.params.classId,
        organizationId: req.user!.organizationId,
      },
    });

    if (!metadataClass) {
      throw new NotFoundError('Classe metadata');
    }

    // Verifica nome campo unico nella classe
    const existingField = await prisma.metadataField.findFirst({
      where: {
        metadataClassId: req.params.classId,
        name: req.body.name,
      },
    });

    if (existingField) {
      throw new ConflictError('Campo con questo nome già esistente nella classe');
    }

    const field = await prisma.metadataField.create({
      data: {
        ...req.body,
        options: req.body.options ? JSON.stringify(req.body.options) : null,
        metadataClassId: req.params.classId,
      },
    });

    res.status(201).json({ success: true, data: field });
  })
);

// Aggiorna campo
router.patch(
  '/fields/:fieldId',
  requireManager,
  validateBody(updateMetadataFieldSchema),
  asyncHandler(async (req, res) => {
    const field = await prisma.metadataField.findFirst({
      where: { id: req.params.fieldId },
      include: {
        metadataClass: true,
      },
    });

    if (!field || field.metadataClass.organizationId !== req.user!.organizationId) {
      throw new NotFoundError('Campo metadata');
    }

    const updated = await prisma.metadataField.update({
      where: { id: req.params.fieldId },
      data: {
        ...req.body,
        options: req.body.options !== undefined ? JSON.stringify(req.body.options) : undefined,
      },
    });

    res.json({ success: true, data: updated });
  })
);

// Elimina campo
router.delete(
  '/fields/:fieldId',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const field = await prisma.metadataField.findFirst({
      where: { id: req.params.fieldId },
      include: {
        metadataClass: true,
        _count: { select: { values: true } },
      },
    });

    if (!field || field.metadataClass.organizationId !== req.user!.organizationId) {
      throw new NotFoundError('Campo metadata');
    }

    // Avvisa se ci sono valori associati
    if (field._count.values > 0) {
      // Elimina anche i valori
      await prisma.documentMetadata.deleteMany({
        where: { fieldId: req.params.fieldId },
      });
    }

    await prisma.metadataField.delete({ where: { id: req.params.fieldId } });

    res.json({ success: true, message: 'Campo eliminato' });
  })
);

// Riordina campi
router.post(
  '/classes/:classId/fields/reorder',
  requireManager,
  asyncHandler(async (req, res) => {
    const { fieldIds } = req.body;

    if (!Array.isArray(fieldIds)) {
      res.status(400).json({
        success: false,
        error: 'fieldIds deve essere un array',
        code: 'INVALID_INPUT',
      });
      return;
    }

    // Verifica che tutti i campi appartengano alla classe
    const fields = await prisma.metadataField.findMany({
      where: {
        metadataClassId: req.params.classId,
        id: { in: fieldIds },
      },
    });

    if (fields.length !== fieldIds.length) {
      res.status(400).json({
        success: false,
        error: 'Alcuni campi non appartengono a questa classe',
        code: 'INVALID_FIELDS',
      });
      return;
    }

    // Aggiorna ordine
    await Promise.all(
      fieldIds.map((id: string, index: number) =>
        prisma.metadataField.update({
          where: { id },
          data: { order: index },
        })
      )
    );

    res.json({ success: true, message: 'Ordine aggiornato' });
  })
);

export default router;
