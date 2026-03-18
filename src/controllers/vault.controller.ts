// Controller Vault per DocuVault

import { Request, Response } from 'express';
import { prisma } from '../services/prisma.service.js';
import { asyncHandler } from '../middleware/error.middleware.js';
import { NotFoundError, ConflictError } from '../types/index.js';

/**
 * POST /api/vaults
 * Crea nuovo vault
 */
export const createVaultController = asyncHandler(async (req: Request, res: Response) => {
  const { name, description, icon, color, metadataClassId } = req.body;

  // Verifica nome unico
  const existing = await prisma.vault.findFirst({
    where: {
      organizationId: req.user!.organizationId,
      name,
    },
  });

  if (existing) {
    throw new ConflictError('Vault con questo nome già esistente');
  }

  // Verifica metadata class se fornita
  if (metadataClassId) {
    const metadataClass = await prisma.metadataClass.findFirst({
      where: {
        id: metadataClassId,
        organizationId: req.user!.organizationId,
      },
    });

    if (!metadataClass) {
      throw new NotFoundError('Classe metadata');
    }
  }

  const vault = await prisma.vault.create({
    data: {
      name,
      description,
      icon,
      color,
      metadataClassId,
      organizationId: req.user!.organizationId,
    },
  });

  res.status(201).json({
    success: true,
    data: vault,
  });
});

/**
 * GET /api/vaults
 * Lista vault dell'organizzazione
 */
export const listVaultsController = asyncHandler(async (req: Request, res: Response) => {
  const userRole = req.user!.role;
  const userId = req.user!.userId;

  // Admin e Manager vedono tutti i vault
  // Gli altri utenti vedono solo i vault di cui sono membri
  const whereClause: any = { organizationId: req.user!.organizationId };

  if (userRole !== 'ADMIN' && userRole !== 'MANAGER') {
    whereClause.members = {
      some: { userId },
    };
  }

  const vaults = await prisma.vault.findMany({
    where: whereClause,
    orderBy: { name: 'asc' },
    include: {
      metadataClass: {
        include: {
          fields: {
            orderBy: { order: 'asc' },
          },
        },
      },
      _count: {
        select: { documents: { where: { deletedAt: null } }, members: true },
      },
    },
  });

  res.json({
    success: true,
    data: vaults,
  });
});

/**
 * GET /api/vaults/:id
 * Dettaglio vault
 */
export const getVaultController = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const vault = await prisma.vault.findFirst({
    where: {
      id,
      organizationId: req.user!.organizationId,
    },
    include: {
      metadataClass: {
        include: {
          fields: {
            orderBy: { order: 'asc' },
          },
        },
      },
      _count: {
        select: { documents: { where: { deletedAt: null } } },
      },
    },
  });

  if (!vault) {
    throw new NotFoundError('Vault');
  }

  res.json({
    success: true,
    data: vault,
  });
});

/**
 * PATCH /api/vaults/:id
 * Aggiorna vault
 */
export const updateVaultController = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, description, icon, color, metadataClassId } = req.body;

  const vault = await prisma.vault.findFirst({
    where: {
      id,
      organizationId: req.user!.organizationId,
    },
  });

  if (!vault) {
    throw new NotFoundError('Vault');
  }

  // Verifica nome unico se cambiato
  if (name && name !== vault.name) {
    const existing = await prisma.vault.findFirst({
      where: {
        organizationId: req.user!.organizationId,
        name,
        id: { not: id },
      },
    });

    if (existing) {
      throw new ConflictError('Vault con questo nome già esistente');
    }
  }

  // Verifica metadata class se cambiata
  if (metadataClassId !== undefined && metadataClassId !== vault.metadataClassId) {
    if (metadataClassId !== null) {
      const metadataClass = await prisma.metadataClass.findFirst({
        where: {
          id: metadataClassId,
          organizationId: req.user!.organizationId,
        },
      });

      if (!metadataClass) {
        throw new NotFoundError('Classe metadata');
      }
    }
  }

  const updated = await prisma.vault.update({
    where: { id },
    data: {
      ...(name && { name }),
      ...(description !== undefined && { description }),
      ...(icon !== undefined && { icon }),
      ...(color !== undefined && { color }),
      ...(metadataClassId !== undefined && { metadataClassId }),
    },
  });

  res.json({
    success: true,
    data: updated,
  });
});

/**
 * DELETE /api/vaults/:id
 * Elimina vault
 */
export const deleteVaultController = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const vault = await prisma.vault.findFirst({
    where: {
      id,
      organizationId: req.user!.organizationId,
    },
    include: {
      _count: { select: { documents: true } },
    },
  });

  if (!vault) {
    throw new NotFoundError('Vault');
  }

  if (vault._count.documents > 0) {
    throw new ConflictError('Impossibile eliminare vault con documenti. Elimina prima i documenti.');
  }

  await prisma.vault.delete({ where: { id } });

  res.json({
    success: true,
    message: 'Vault eliminato',
  });
});

/**
 * GET /api/vaults/:id/stats
 * Statistiche vault
 */
export const getVaultStatsController = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const vault = await prisma.vault.findFirst({
    where: {
      id,
      organizationId: req.user!.organizationId,
    },
  });

  if (!vault) {
    throw new NotFoundError('Vault');
  }

  // Conta documenti per stato
  const documentsByStatus = await prisma.document.groupBy({
    by: ['status'],
    where: {
      vaultId: id,
      deletedAt: null,
    },
    _count: true,
  });

  // Conta documenti per tipo MIME
  const documentsByType = await prisma.document.groupBy({
    by: ['mimeType'],
    where: {
      vaultId: id,
      deletedAt: null,
    },
    _count: true,
  });

  // Storage totale
  const storageResult = await prisma.$queryRaw<[{ total: bigint }]>`
    SELECT COALESCE(SUM(dv."fileSizeBytes"), 0) as total
    FROM "DocumentVersion" dv
    JOIN "Document" d ON dv."documentId" = d.id
    WHERE d."vaultId" = ${id} AND d."deletedAt" IS NULL
  `;

  const totalStorageBytes = Number(storageResult[0]?.total || 0);

  // Documenti recenti
  const recentActivity = await prisma.document.count({
    where: {
      vaultId: id,
      deletedAt: null,
      updatedAt: {
        gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Ultimi 7 giorni
      },
    },
  });

  res.json({
    success: true,
    data: {
      documentsByStatus: documentsByStatus.map(item => ({
        status: item.status,
        count: item._count,
      })),
      documentsByType: documentsByType.map(item => ({
        mimeType: item.mimeType,
        count: item._count,
      })),
      totalStorageMB: Math.round(totalStorageBytes / (1024 * 1024) * 100) / 100,
      recentActivityCount: recentActivity,
    },
  });
});

/**
 * GET /api/vaults/:id/members
 * Lista membri del vault
 */
export const listVaultMembersController = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const vault = await prisma.vault.findFirst({
    where: {
      id,
      organizationId: req.user!.organizationId,
    },
  });

  if (!vault) {
    throw new NotFoundError('Vault');
  }

  const members = await prisma.vaultMember.findMany({
    where: { vaultId: id },
    include: {
      user: {
        select: { id: true, firstName: true, lastName: true, email: true, role: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  res.json({
    success: true,
    data: members,
  });
});

/**
 * POST /api/vaults/:id/members
 * Aggiungi membro al vault
 */
export const addVaultMemberController = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { userId, canEdit } = req.body;

  const vault = await prisma.vault.findFirst({
    where: {
      id,
      organizationId: req.user!.organizationId,
    },
  });

  if (!vault) {
    throw new NotFoundError('Vault');
  }

  // Verifica utente
  const targetUser = await prisma.user.findFirst({
    where: {
      id: userId,
      organizationId: req.user!.organizationId,
    },
  });

  if (!targetUser) {
    throw new NotFoundError('Utente');
  }

  // Verifica se già membro
  const existing = await prisma.vaultMember.findUnique({
    where: { vaultId_userId: { vaultId: id, userId } },
  });

  if (existing) {
    throw new ConflictError('Utente già membro del vault');
  }

  const member = await prisma.vaultMember.create({
    data: {
      vaultId: id,
      userId,
      canEdit: canEdit || false,
    },
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
 * PATCH /api/vaults/:id/members/:userId
 * Aggiorna permessi membro
 */
export const updateVaultMemberController = asyncHandler(async (req: Request, res: Response) => {
  const { id, userId } = req.params;
  const { canEdit } = req.body;

  const member = await prisma.vaultMember.findFirst({
    where: {
      vaultId: id,
      userId,
      vault: { organizationId: req.user!.organizationId },
    },
  });

  if (!member) {
    throw new NotFoundError('Membro');
  }

  const updated = await prisma.vaultMember.update({
    where: { vaultId_userId: { vaultId: id, userId } },
    data: { canEdit },
    include: {
      user: {
        select: { id: true, firstName: true, lastName: true, email: true, role: true },
      },
    },
  });

  res.json({
    success: true,
    data: updated,
  });
});

/**
 * DELETE /api/vaults/:id/members/:userId
 * Rimuovi membro dal vault
 */
export const removeVaultMemberController = asyncHandler(async (req: Request, res: Response) => {
  const { id, userId } = req.params;

  const member = await prisma.vaultMember.findFirst({
    where: {
      vaultId: id,
      userId,
      vault: { organizationId: req.user!.organizationId },
    },
  });

  if (!member) {
    throw new NotFoundError('Membro');
  }

  await prisma.vaultMember.delete({
    where: { vaultId_userId: { vaultId: id, userId } },
  });

  res.json({
    success: true,
    message: 'Membro rimosso dal vault',
  });
});
