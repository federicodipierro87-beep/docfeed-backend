// Controller Viste Salvate per DocuVault

import { Request, Response } from 'express';
import { prisma } from '../services/prisma.service.js';
import { asyncHandler } from '../middleware/error.middleware.js';
import { JwtPayload, NotFoundError } from '../types/index.js';

/**
 * GET /api/views
 * Lista viste salvate (proprie + pubbliche)
 */
export const listViewsController = asyncHandler(async (req: Request, res: Response) => {
  const user = req.user as JwtPayload;

  const views = await prisma.savedView.findMany({
    where: {
      organizationId: user.organizationId,
      OR: [
        { createdById: user.userId },
        { isPublic: true },
      ],
    },
    include: {
      createdBy: {
        select: { id: true, firstName: true, lastName: true },
      },
    },
    orderBy: { name: 'asc' },
  });

  res.json({
    success: true,
    data: views,
  });
});

/**
 * GET /api/views/:id
 * Dettaglio vista
 */
export const getViewController = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const user = req.user as JwtPayload;

  const view = await prisma.savedView.findFirst({
    where: {
      id,
      organizationId: user.organizationId,
      OR: [
        { createdById: user.userId },
        { isPublic: true },
      ],
    },
    include: {
      createdBy: {
        select: { id: true, firstName: true, lastName: true },
      },
    },
  });

  if (!view) {
    throw new NotFoundError('Vista');
  }

  res.json({
    success: true,
    data: view,
  });
});

/**
 * GET /api/views/:id/execute
 * Esegue la vista e ritorna i documenti
 */
export const executeViewController = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const user = req.user as JwtPayload;

  const view = await prisma.savedView.findFirst({
    where: {
      id,
      organizationId: user.organizationId,
      OR: [
        { createdById: user.userId },
        { isPublic: true },
      ],
    },
  });

  if (!view) {
    throw new NotFoundError('Vista');
  }

  const filters = view.filters as any;

  // Costruisci la query per i documenti
  const where: any = {
    vault: { organizationId: user.organizationId },
    deletedAt: null,
  };

  if (filters.vaultId) {
    where.vaultId = filters.vaultId;
  }

  if (filters.status) {
    where.status = filters.status;
  }

  if (filters.mimeType) {
    where.mimeType = { contains: filters.mimeType };
  }

  if (filters.workflowStateId) {
    where.workflowStateId = filters.workflowStateId;
  }

  if (filters.createdById) {
    where.createdById = filters.createdById;
  }

  if (filters.createdAfter) {
    where.createdAt = { ...where.createdAt, gte: new Date(filters.createdAfter) };
  }

  if (filters.createdBefore) {
    where.createdAt = { ...where.createdAt, lte: new Date(filters.createdBefore) };
  }

  if (filters.search) {
    where.OR = [
      { name: { contains: filters.search, mode: 'insensitive' } },
      { description: { contains: filters.search, mode: 'insensitive' } },
    ];
  }

  if (filters.tags && filters.tags.length > 0) {
    where.tags = {
      some: {
        tagId: { in: filters.tags },
      },
    };
  }

  const documents = await prisma.document.findMany({
    where,
    include: {
      vault: { select: { id: true, name: true, color: true } },
      createdBy: { select: { id: true, firstName: true, lastName: true } },
      currentVersion: { select: { id: true, fileSizeBytes: true } },
      workflowState: { select: { id: true, name: true, color: true } },
    },
    orderBy: { updatedAt: 'desc' },
    take: 100,
  });

  res.json({
    success: true,
    data: {
      view,
      documents,
      count: documents.length,
    },
  });
});

/**
 * POST /api/views
 * Crea vista
 */
export const createViewController = asyncHandler(async (req: Request, res: Response) => {
  const { name, description, icon, color, filters, isPublic } = req.body;
  const user = req.user as JwtPayload;

  const view = await prisma.savedView.create({
    data: {
      name,
      description,
      icon: icon || 'folder-search',
      color: color || '#6366f1',
      filters: filters || {},
      isPublic: isPublic || false,
      createdById: user.userId,
      organizationId: user.organizationId,
    },
    include: {
      createdBy: {
        select: { id: true, firstName: true, lastName: true },
      },
    },
  });

  res.status(201).json({
    success: true,
    data: view,
  });
});

/**
 * PATCH /api/views/:id
 * Aggiorna vista
 */
export const updateViewController = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, description, icon, color, filters, isPublic } = req.body;
  const user = req.user as JwtPayload;

  const existing = await prisma.savedView.findFirst({
    where: {
      id,
      organizationId: user.organizationId,
      createdById: user.userId, // Solo il creatore può modificare
    },
  });

  if (!existing) {
    throw new NotFoundError('Vista');
  }

  const view = await prisma.savedView.update({
    where: { id },
    data: {
      ...(name && { name }),
      ...(description !== undefined && { description }),
      ...(icon && { icon }),
      ...(color && { color }),
      ...(filters && { filters }),
      ...(isPublic !== undefined && { isPublic }),
    },
    include: {
      createdBy: {
        select: { id: true, firstName: true, lastName: true },
      },
    },
  });

  res.json({
    success: true,
    data: view,
  });
});

/**
 * DELETE /api/views/:id
 * Elimina vista
 */
export const deleteViewController = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const user = req.user as JwtPayload;

  const existing = await prisma.savedView.findFirst({
    where: {
      id,
      organizationId: user.organizationId,
      createdById: user.userId, // Solo il creatore può eliminare
    },
  });

  if (!existing) {
    throw new NotFoundError('Vista');
  }

  await prisma.savedView.delete({ where: { id } });

  res.json({
    success: true,
    message: 'Vista eliminata',
  });
});
