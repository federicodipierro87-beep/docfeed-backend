// Controller Gruppi Utenti per DocuVault

import { Request, Response } from 'express';
import { prisma } from '../services/prisma.service.js';
import { asyncHandler } from '../middleware/error.middleware.js';
import { JwtPayload, NotFoundError } from '../types/index.js';

/**
 * GET /api/user-groups
 * Lista gruppi utenti
 */
export const listGroupsController = asyncHandler(async (req: Request, res: Response) => {
  const user = req.user as JwtPayload;

  const groups = await prisma.userGroup.findMany({
    where: { organizationId: user.organizationId },
    include: {
      members: {
        include: {
          user: {
            select: { id: true, firstName: true, lastName: true, email: true, role: true },
          },
        },
      },
      _count: { select: { members: true } },
    },
    orderBy: { name: 'asc' },
  });

  res.json({
    success: true,
    data: groups,
  });
});

/**
 * GET /api/user-groups/:id
 * Dettaglio gruppo
 */
export const getGroupController = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const user = req.user as JwtPayload;

  const group = await prisma.userGroup.findFirst({
    where: { id, organizationId: user.organizationId },
    include: {
      members: {
        include: {
          user: {
            select: { id: true, firstName: true, lastName: true, email: true, role: true },
          },
        },
      },
    },
  });

  if (!group) {
    throw new NotFoundError('Gruppo');
  }

  res.json({
    success: true,
    data: group,
  });
});

/**
 * POST /api/user-groups
 * Crea gruppo
 */
export const createGroupController = asyncHandler(async (req: Request, res: Response) => {
  const { name, description, color } = req.body;
  const user = req.user as JwtPayload;

  const group = await prisma.userGroup.create({
    data: {
      name,
      description,
      color: color || '#6366f1',
      organizationId: user.organizationId,
    },
    include: {
      _count: { select: { members: true } },
    },
  });

  res.status(201).json({
    success: true,
    data: group,
  });
});

/**
 * PATCH /api/user-groups/:id
 * Aggiorna gruppo
 */
export const updateGroupController = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, description, color } = req.body;
  const user = req.user as JwtPayload;

  const existing = await prisma.userGroup.findFirst({
    where: { id, organizationId: user.organizationId },
  });

  if (!existing) {
    throw new NotFoundError('Gruppo');
  }

  const group = await prisma.userGroup.update({
    where: { id },
    data: {
      ...(name && { name }),
      ...(description !== undefined && { description }),
      ...(color && { color }),
    },
    include: {
      _count: { select: { members: true } },
    },
  });

  res.json({
    success: true,
    data: group,
  });
});

/**
 * DELETE /api/user-groups/:id
 * Elimina gruppo
 */
export const deleteGroupController = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const user = req.user as JwtPayload;

  const existing = await prisma.userGroup.findFirst({
    where: { id, organizationId: user.organizationId },
  });

  if (!existing) {
    throw new NotFoundError('Gruppo');
  }

  await prisma.userGroup.delete({ where: { id } });

  res.json({
    success: true,
    message: 'Gruppo eliminato',
  });
});

/**
 * POST /api/user-groups/:id/members
 * Aggiungi membro al gruppo
 */
export const addMemberController = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { userId } = req.body;
  const user = req.user as JwtPayload;

  const group = await prisma.userGroup.findFirst({
    where: { id, organizationId: user.organizationId },
  });

  if (!group) {
    throw new NotFoundError('Gruppo');
  }

  // Verifica che l'utente esista nella stessa organizzazione
  const targetUser = await prisma.user.findFirst({
    where: { id: userId, organizationId: user.organizationId },
  });

  if (!targetUser) {
    throw new NotFoundError('Utente');
  }

  // Verifica se già membro
  const existingMember = await prisma.userGroupMember.findUnique({
    where: { groupId_userId: { groupId: id, userId } },
  });

  if (existingMember) {
    res.status(400).json({
      success: false,
      error: 'Utente già membro del gruppo',
      code: 'ALREADY_MEMBER',
    });
    return;
  }

  const member = await prisma.userGroupMember.create({
    data: { groupId: id, userId },
    include: {
      user: {
        select: { id: true, firstName: true, lastName: true, email: true, role: true },
      },
    },
  });

  res.status(201).json({
    success: true,
    data: member,
  });
});

/**
 * DELETE /api/user-groups/:id/members/:userId
 * Rimuovi membro dal gruppo
 */
export const removeMemberController = asyncHandler(async (req: Request, res: Response) => {
  const { id, userId } = req.params;
  const user = req.user as JwtPayload;

  const group = await prisma.userGroup.findFirst({
    where: { id, organizationId: user.organizationId },
  });

  if (!group) {
    throw new NotFoundError('Gruppo');
  }

  const member = await prisma.userGroupMember.findUnique({
    where: { groupId_userId: { groupId: id, userId } },
  });

  if (!member) {
    throw new NotFoundError('Membro');
  }

  await prisma.userGroupMember.delete({
    where: { groupId_userId: { groupId: id, userId } },
  });

  res.json({
    success: true,
    message: 'Membro rimosso dal gruppo',
  });
});
