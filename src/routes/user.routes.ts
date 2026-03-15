// Routes Utenti per DocuVault

import { Router } from 'express';
import { prisma } from '../services/prisma.service.js';
import { getUserAuditLogs } from '../services/audit.service.js';
import { authenticate, requireAdmin, requireManager } from '../middleware/auth.middleware.js';
import { requireValidLicense } from '../middleware/license.middleware.js';
import { asyncHandler, validateBody } from '../middleware/error.middleware.js';
import { updateUserSchema } from '../utils/validation.js';
import { NotFoundError, AuthorizationError, ConflictError } from '../types/index.js';
import { JwtPayload } from '../types/index.js';

const router = Router();

// Middleware
router.use(authenticate);
router.use(requireValidLicense);

// Lista utenti
router.get(
  '/',
  requireManager,
  asyncHandler(async (req, res) => {
    const { role, isActive, search, cursor, limit } = req.query;

    const pageLimit = limit ? parseInt(limit as string) : 20;

    const users = await prisma.user.findMany({
      where: {
        organizationId: req.user!.organizationId,
        ...(role && { role: role as any }),
        ...(isActive !== undefined && { isActive: isActive === 'true' }),
        ...(search && {
          OR: [
            { firstName: { contains: search as string, mode: 'insensitive' } },
            { lastName: { contains: search as string, mode: 'insensitive' } },
            { email: { contains: search as string, mode: 'insensitive' } },
          ],
        }),
      },
      ...(cursor && { cursor: { id: cursor as string }, skip: 1 }),
      take: pageLimit + 1,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        avatar: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });

    const hasMore = users.length > pageLimit;
    const items = hasMore ? users.slice(0, -1) : users;
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    res.json({
      success: true,
      data: { items, nextCursor, hasMore },
    });
  })
);

// Dettaglio utente
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    // Utente può vedere solo se stesso o se è admin/manager
    if (
      req.params.id !== req.user!.userId &&
      req.user!.role !== 'ADMIN' &&
      req.user!.role !== 'MANAGER'
    ) {
      throw new AuthorizationError('Non autorizzato a visualizzare questo utente');
    }

    const user = await prisma.user.findFirst({
      where: {
        id: req.params.id,
        organizationId: req.user!.organizationId,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        avatar: true,
        isActive: true,
        emailVerified: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            documents: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundError('Utente');
    }

    res.json({ success: true, data: user });
  })
);

// Aggiorna utente
router.patch(
  '/:id',
  requireAdmin,
  validateBody(updateUserSchema),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findFirst({
      where: {
        id: req.params.id,
        organizationId: req.user!.organizationId,
      },
    });

    if (!user) {
      throw new NotFoundError('Utente');
    }

    // Non può modificare se stesso per ruolo
    if (req.params.id === req.user!.userId && req.body.role) {
      throw new AuthorizationError('Non puoi modificare il tuo stesso ruolo');
    }

    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data: req.body,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        avatar: true,
        isActive: true,
        updatedAt: true,
      },
    });

    res.json({ success: true, data: updated });
  })
);

// Disattiva utente
router.post(
  '/:id/deactivate',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findFirst({
      where: {
        id: req.params.id,
        organizationId: req.user!.organizationId,
      },
    });

    if (!user) {
      throw new NotFoundError('Utente');
    }

    // Non può disattivare se stesso
    if (req.params.id === req.user!.userId) {
      throw new AuthorizationError('Non puoi disattivare te stesso');
    }

    await prisma.user.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });

    // Revoca tutti i token
    await prisma.refreshToken.updateMany({
      where: { userId: req.params.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    res.json({ success: true, message: 'Utente disattivato' });
  })
);

// Riattiva utente
router.post(
  '/:id/activate',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findFirst({
      where: {
        id: req.params.id,
        organizationId: req.user!.organizationId,
      },
    });

    if (!user) {
      throw new NotFoundError('Utente');
    }

    await prisma.user.update({
      where: { id: req.params.id },
      data: { isActive: true },
    });

    res.json({ success: true, message: 'Utente riattivato' });
  })
);

// Elimina utente
router.delete(
  '/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findFirst({
      where: {
        id: req.params.id,
        organizationId: req.user!.organizationId,
      },
      include: {
        _count: { select: { documents: true } },
      },
    });

    if (!user) {
      throw new NotFoundError('Utente');
    }

    // Non può eliminare se stesso
    if (req.params.id === req.user!.userId) {
      throw new AuthorizationError('Non puoi eliminare te stesso');
    }

    // Verifica se ha documenti
    if (user._count.documents > 0) {
      throw new ConflictError(
        'Impossibile eliminare utente con documenti. Trasferisci prima i documenti.'
      );
    }

    await prisma.user.delete({ where: { id: req.params.id } });

    res.json({ success: true, message: 'Utente eliminato' });
  })
);

// Audit log utente
router.get(
  '/:id/audit',
  asyncHandler(async (req, res) => {
    const { cursor, limit } = req.query;

    const result = await getUserAuditLogs(
      req.params.id,
      {
        cursor: cursor as string,
        limit: limit ? parseInt(limit as string) : undefined,
      },
      req.user as JwtPayload
    );

    res.json({ success: true, data: result });
  })
);

export default router;
