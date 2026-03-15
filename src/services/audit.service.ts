// Servizio Audit Log per DocuVault
// Log immutabile di tutte le azioni

import { AuditAction, Prisma } from '@prisma/client';
import { prisma } from './prisma.service.js';
import { logger } from '../utils/logger.js';
import { JwtPayload, PaginatedResult, PaginationParams } from '../types/index.js';

interface AuditLogEntry {
  action: AuditAction | string;
  entityType: string;
  entityId: string;
  documentId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

interface AuditLogFilters {
  userId?: string;
  documentId?: string;
  action?: AuditAction | string;
  entityType?: string;
  startDate?: Date;
  endDate?: Date;
}

// === CREAZIONE LOG ===

export async function createAuditLog(
  entry: AuditLogEntry,
  user: JwtPayload,
  requestInfo?: { ip?: string; userAgent?: string }
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: entry.action as AuditAction,
        entityType: entry.entityType,
        entityId: entry.entityId,
        userId: user.userId,
        documentId: entry.documentId,
        details: entry.details as Prisma.JsonObject | undefined,
        ipAddress: requestInfo?.ip,
        userAgent: requestInfo?.userAgent,
      },
    });
  } catch (error) {
    // Non blocchiamo l'operazione se il log fallisce
    logger.error('Errore creazione audit log', {
      error: (error as Error).message,
      entry,
    });
  }
}

// === QUERY AUDIT LOG ===

export async function getAuditLogs(
  filters: AuditLogFilters,
  pagination: PaginationParams,
  user: JwtPayload
): Promise<PaginatedResult<{
  id: string;
  action: AuditAction;
  entityType: string;
  entityId: string;
  user: { id: string; firstName: string; lastName: string; email: string };
  document: { id: string; name: string } | null;
  details: Prisma.JsonValue;
  ipAddress: string | null;
  createdAt: Date;
}>> {
  const limit = pagination.limit || 50;

  // Verifica che l'utente possa vedere i log (solo admin/manager)
  if (user.role !== 'ADMIN' && user.role !== 'MANAGER') {
    return { items: [], nextCursor: null, hasMore: false };
  }

  const where: Prisma.AuditLogWhereInput = {
    user: { organizationId: user.organizationId },
    ...(filters.userId && { userId: filters.userId }),
    ...(filters.documentId && { documentId: filters.documentId }),
    ...(filters.action && { action: filters.action as AuditAction }),
    ...(filters.entityType && { entityType: filters.entityType }),
    ...(filters.startDate && { createdAt: { gte: filters.startDate } }),
    ...(filters.endDate && { createdAt: { lte: filters.endDate } }),
  };

  const logs = await prisma.auditLog.findMany({
    where,
    take: limit + 1,
    orderBy: { createdAt: 'desc' },
    include: {
      user: { select: { id: true, firstName: true, lastName: true, email: true } },
      document: { select: { id: true, name: true } },
    },
    ...(pagination.cursor && { cursor: { id: pagination.cursor }, skip: 1 }),
  });

  const hasMore = logs.length > limit;
  const items = hasMore ? logs.slice(0, -1) : logs;
  const nextCursor = hasMore ? items[items.length - 1].id : null;

  return { items, nextCursor, hasMore };
}

// === LOG PER DOCUMENTO ===

export async function getDocumentAuditLogs(
  documentId: string,
  pagination: PaginationParams,
  user: JwtPayload
): Promise<PaginatedResult<{
  id: string;
  action: AuditAction;
  user: { id: string; firstName: string; lastName: string };
  details: Prisma.JsonValue;
  createdAt: Date;
}>> {
  const limit = pagination.limit || 20;

  // Verifica accesso al documento
  const document = await prisma.document.findFirst({
    where: {
      id: documentId,
      vault: { organizationId: user.organizationId },
    },
  });

  if (!document) {
    return { items: [], nextCursor: null, hasMore: false };
  }

  const logs = await prisma.auditLog.findMany({
    where: { documentId },
    take: limit + 1,
    orderBy: { createdAt: 'desc' },
    include: {
      user: { select: { id: true, firstName: true, lastName: true } },
    },
    ...(pagination.cursor && { cursor: { id: pagination.cursor }, skip: 1 }),
  });

  const hasMore = logs.length > limit;
  const items = hasMore ? logs.slice(0, -1) : logs;
  const nextCursor = hasMore ? items[items.length - 1].id : null;

  return { items, nextCursor, hasMore };
}

// === LOG PER UTENTE ===

export async function getUserAuditLogs(
  targetUserId: string,
  pagination: PaginationParams,
  user: JwtPayload
): Promise<PaginatedResult<{
  id: string;
  action: AuditAction;
  entityType: string;
  entityId: string;
  document: { id: string; name: string } | null;
  details: Prisma.JsonValue;
  createdAt: Date;
}>> {
  const limit = pagination.limit || 20;

  // Solo admin può vedere log di altri utenti
  if (user.role !== 'ADMIN' && user.userId !== targetUserId) {
    return { items: [], nextCursor: null, hasMore: false };
  }

  // Verifica che l'utente target sia nella stessa organizzazione
  const targetUser = await prisma.user.findFirst({
    where: {
      id: targetUserId,
      organizationId: user.organizationId,
    },
  });

  if (!targetUser) {
    return { items: [], nextCursor: null, hasMore: false };
  }

  const logs = await prisma.auditLog.findMany({
    where: { userId: targetUserId },
    take: limit + 1,
    orderBy: { createdAt: 'desc' },
    include: {
      document: { select: { id: true, name: true } },
    },
    ...(pagination.cursor && { cursor: { id: pagination.cursor }, skip: 1 }),
  });

  const hasMore = logs.length > limit;
  const items = hasMore ? logs.slice(0, -1) : logs;
  const nextCursor = hasMore ? items[items.length - 1].id : null;

  return { items, nextCursor, hasMore };
}

// === STATISTICHE ===

export async function getAuditStats(
  user: JwtPayload,
  days: number = 30
): Promise<{
  totalActions: number;
  actionsByType: Record<string, number>;
  actionsByUser: Array<{ userId: string; userName: string; count: number }>;
  actionsPerDay: Array<{ date: string; count: number }>;
}> {
  if (user.role !== 'ADMIN' && user.role !== 'MANAGER') {
    return {
      totalActions: 0,
      actionsByType: {},
      actionsByUser: [],
      actionsPerDay: [],
    };
  }

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  // Total actions
  const totalActions = await prisma.auditLog.count({
    where: {
      user: { organizationId: user.organizationId },
      createdAt: { gte: startDate },
    },
  });

  // Actions by type
  const actionsByTypeRaw = await prisma.auditLog.groupBy({
    by: ['action'],
    where: {
      user: { organizationId: user.organizationId },
      createdAt: { gte: startDate },
    },
    _count: true,
  });

  const actionsByType: Record<string, number> = {};
  for (const item of actionsByTypeRaw) {
    actionsByType[item.action] = item._count;
  }

  // Actions by user (top 10)
  const actionsByUserRaw = await prisma.auditLog.groupBy({
    by: ['userId'],
    where: {
      user: { organizationId: user.organizationId },
      createdAt: { gte: startDate },
    },
    _count: true,
    orderBy: { _count: { userId: 'desc' } },
    take: 10,
  });

  const userIds = actionsByUserRaw.map(item => item.userId);
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, firstName: true, lastName: true },
  });

  const actionsByUser = actionsByUserRaw.map(item => {
    const userData = users.find(u => u.id === item.userId);
    return {
      userId: item.userId,
      userName: userData ? `${userData.firstName} ${userData.lastName}` : 'Sconosciuto',
      count: item._count,
    };
  });

  // Actions per day
  const actionsPerDayRaw = await prisma.$queryRaw<Array<{ date: Date; count: bigint }>>`
    SELECT DATE("createdAt") as date, COUNT(*) as count
    FROM "AuditLog" al
    JOIN "User" u ON al."userId" = u.id
    WHERE u."organizationId" = ${user.organizationId}
      AND al."createdAt" >= ${startDate}
    GROUP BY DATE("createdAt")
    ORDER BY date ASC
  `;

  const actionsPerDay = actionsPerDayRaw.map(item => ({
    date: item.date.toISOString().split('T')[0],
    count: Number(item.count),
  }));

  return {
    totalActions,
    actionsByType,
    actionsByUser,
    actionsPerDay,
  };
}

// === EXPORT ===

export async function exportAuditLogs(
  filters: AuditLogFilters,
  user: JwtPayload,
  format: 'json' | 'csv' = 'json'
): Promise<string> {
  if (user.role !== 'ADMIN') {
    throw new Error('Solo Admin può esportare i log');
  }

  const where: Prisma.AuditLogWhereInput = {
    user: { organizationId: user.organizationId },
    ...(filters.userId && { userId: filters.userId }),
    ...(filters.documentId && { documentId: filters.documentId }),
    ...(filters.action && { action: filters.action as AuditAction }),
    ...(filters.entityType && { entityType: filters.entityType }),
    ...(filters.startDate && { createdAt: { gte: filters.startDate } }),
    ...(filters.endDate && { createdAt: { lte: filters.endDate } }),
  };

  const logs = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      user: { select: { email: true, firstName: true, lastName: true } },
      document: { select: { name: true } },
    },
    take: 10000, // Limite export
  });

  if (format === 'csv') {
    const headers = ['Data', 'Azione', 'Utente', 'Email', 'Tipo Entità', 'ID Entità', 'Documento', 'IP'];
    const rows = logs.map(log => [
      log.createdAt.toISOString(),
      log.action,
      `${log.user.firstName} ${log.user.lastName}`,
      log.user.email,
      log.entityType,
      log.entityId,
      log.document?.name || '',
      log.ipAddress || '',
    ]);

    return [headers.join(','), ...rows.map(row => row.map(cell => `"${cell}"`).join(','))].join('\n');
  }

  return JSON.stringify(logs, null, 2);
}

// === CLEANUP VECCHI LOG ===

export async function cleanupOldAuditLogs(retentionDays: number = 365): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  const result = await prisma.auditLog.deleteMany({
    where: {
      createdAt: { lt: cutoffDate },
    },
  });

  logger.info('Cleanup audit logs completato', {
    deletedCount: result.count,
    cutoffDate,
  });

  return result.count;
}
