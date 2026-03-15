// Servizio Retention Policies per DocuVault
// Gestione scadenze documenti e azioni automatiche

import Bull from 'bull';
import { RetentionAction, DocumentStatus, Prisma } from '@prisma/client';
import { prisma } from './prisma.service.js';
import { sendRetentionExpiryNotification } from './email.service.js';
import { deleteFile } from './storage.service.js';
import { updateStorageUsage } from './license.service.js';
import { logger } from '../utils/logger.js';
import { JwtPayload, NotFoundError, ConflictError } from '../types/index.js';

// === CRUD RETENTION POLICIES ===

export async function createRetentionPolicy(
  data: {
    name: string;
    description?: string;
    retentionDays: number;
    action: RetentionAction;
    conditions?: Record<string, unknown>;
  },
  user: JwtPayload
) {
  // Verifica nome unico
  const existing = await prisma.retentionPolicy.findFirst({
    where: {
      organizationId: user.organizationId,
      name: data.name,
    },
  });

  if (existing) {
    throw new ConflictError('Retention policy con questo nome già esistente');
  }

  return prisma.retentionPolicy.create({
    data: {
      name: data.name,
      description: data.description,
      retentionDays: data.retentionDays,
      action: data.action,
      conditions: data.conditions as Prisma.JsonObject | undefined,
      organizationId: user.organizationId,
    },
  });
}

export async function getRetentionPolicy(policyId: string, user: JwtPayload) {
  const policy = await prisma.retentionPolicy.findFirst({
    where: {
      id: policyId,
      organizationId: user.organizationId,
    },
    include: {
      _count: { select: { documents: true } },
    },
  });

  if (!policy) {
    throw new NotFoundError('Retention policy');
  }

  return policy;
}

export async function listRetentionPolicies(user: JwtPayload) {
  return prisma.retentionPolicy.findMany({
    where: { organizationId: user.organizationId },
    orderBy: { name: 'asc' },
    include: {
      _count: { select: { documents: true } },
    },
  });
}

export async function updateRetentionPolicy(
  policyId: string,
  data: {
    name?: string;
    description?: string;
    retentionDays?: number;
    action?: RetentionAction;
    isActive?: boolean;
    conditions?: Record<string, unknown>;
  },
  user: JwtPayload
) {
  const policy = await prisma.retentionPolicy.findFirst({
    where: {
      id: policyId,
      organizationId: user.organizationId,
    },
  });

  if (!policy) {
    throw new NotFoundError('Retention policy');
  }

  return prisma.retentionPolicy.update({
    where: { id: policyId },
    data: {
      ...data,
      conditions: data.conditions as Prisma.JsonObject | undefined,
    },
  });
}

export async function deleteRetentionPolicy(policyId: string, user: JwtPayload) {
  const policy = await prisma.retentionPolicy.findFirst({
    where: {
      id: policyId,
      organizationId: user.organizationId,
    },
    include: {
      _count: { select: { documents: true } },
    },
  });

  if (!policy) {
    throw new NotFoundError('Retention policy');
  }

  if (policy._count.documents > 0) {
    throw new ConflictError('Impossibile eliminare policy con documenti associati');
  }

  await prisma.retentionPolicy.delete({ where: { id: policyId } });
}

// === APPLICAZIONE POLICY AI DOCUMENTI ===

export async function applyRetentionPolicy(
  documentId: string,
  policyId: string,
  user: JwtPayload
) {
  const policy = await prisma.retentionPolicy.findFirst({
    where: {
      id: policyId,
      organizationId: user.organizationId,
    },
  });

  if (!policy) {
    throw new NotFoundError('Retention policy');
  }

  const document = await prisma.document.findFirst({
    where: {
      id: documentId,
      vault: { organizationId: user.organizationId },
    },
  });

  if (!document) {
    throw new NotFoundError('Documento');
  }

  // Calcola data scadenza
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + policy.retentionDays);

  await prisma.document.update({
    where: { id: documentId },
    data: {
      retentionPolicyId: policyId,
      retentionExpiresAt: expiresAt,
    },
  });

  logger.info('Retention policy applicata', { documentId, policyId, expiresAt });
}

export async function removeRetentionPolicy(documentId: string, user: JwtPayload) {
  const document = await prisma.document.findFirst({
    where: {
      id: documentId,
      vault: { organizationId: user.organizationId },
    },
  });

  if (!document) {
    throw new NotFoundError('Documento');
  }

  await prisma.document.update({
    where: { id: documentId },
    data: {
      retentionPolicyId: null,
      retentionExpiresAt: null,
    },
  });
}

// === JOB SCHEDULATO ===

let retentionQueue: Bull.Queue | null = null;

export function getRetentionQueue(): Bull.Queue {
  if (!retentionQueue) {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

    retentionQueue = new Bull('retention-check', redisUrl, {
      defaultJobOptions: {
        attempts: 3,
        removeOnComplete: true,
        removeOnFail: false,
      },
    });

    // Processor
    retentionQueue.process(async () => {
      await processRetentionPolicies();
    });

    retentionQueue.on('completed', (job) => {
      logger.info('Retention check completato', { jobId: job.id });
    });

    retentionQueue.on('failed', (job, err) => {
      logger.error('Retention check fallito', { jobId: job?.id, error: err.message });
    });

    // Schedula job giornaliero (ogni giorno alle 2:00)
    retentionQueue.add(
      {},
      {
        repeat: {
          cron: '0 2 * * *', // Ogni giorno alle 02:00
        },
      }
    );
  }

  return retentionQueue;
}

async function processRetentionPolicies(): Promise<void> {
  logger.info('Inizio elaborazione retention policies');

  const now = new Date();

  // Trova documenti in scadenza (scadono nei prossimi 7 giorni)
  const warningDate = new Date();
  warningDate.setDate(warningDate.getDate() + 7);

  // Documenti da notificare (scadono entro 7 giorni)
  const documentsToNotify = await prisma.document.findMany({
    where: {
      deletedAt: null,
      retentionExpiresAt: {
        gte: now,
        lte: warningDate,
      },
      retentionPolicy: {
        action: RetentionAction.NOTIFY,
      },
    },
    include: {
      retentionPolicy: true,
      vault: {
        include: {
          organization: {
            include: {
              users: {
                where: { role: { in: ['ADMIN', 'MANAGER'] } },
              },
            },
          },
        },
      },
    },
  });

  // Raggruppa per organizzazione e invia notifiche
  const notificationsByOrg = new Map<string, typeof documentsToNotify>();

  for (const doc of documentsToNotify) {
    const orgId = doc.vault.organizationId;
    if (!notificationsByOrg.has(orgId)) {
      notificationsByOrg.set(orgId, []);
    }
    notificationsByOrg.get(orgId)!.push(doc);
  }

  for (const [orgId, docs] of notificationsByOrg) {
    const admins = docs[0].vault.organization.users;

    for (const admin of admins) {
      await sendRetentionExpiryNotification(
        admin.email,
        admin.firstName,
        docs.map(d => ({
          name: d.name,
          expiresAt: d.retentionExpiresAt!,
          action: d.retentionPolicy!.action,
        }))
      );
    }
  }

  // Documenti scaduti - Esegui azioni
  const expiredDocuments = await prisma.document.findMany({
    where: {
      deletedAt: null,
      retentionExpiresAt: {
        lt: now,
      },
    },
    include: {
      retentionPolicy: true,
      versions: true,
      vault: true,
    },
  });

  for (const doc of expiredDocuments) {
    if (!doc.retentionPolicy) continue;

    try {
      switch (doc.retentionPolicy.action) {
        case RetentionAction.ARCHIVE:
          await archiveDocument(doc);
          break;

        case RetentionAction.DELETE:
          await deleteDocumentPermanently(doc);
          break;

        case RetentionAction.NOTIFY:
          // Già gestito sopra
          break;
      }
    } catch (error) {
      logger.error('Errore elaborazione retention per documento', {
        documentId: doc.id,
        action: doc.retentionPolicy.action,
        error: (error as Error).message,
      });
    }
  }

  logger.info('Elaborazione retention policies completata', {
    notified: documentsToNotify.length,
    expired: expiredDocuments.length,
  });
}

async function archiveDocument(doc: {
  id: string;
  name: string;
}) {
  await prisma.document.update({
    where: { id: doc.id },
    data: { status: DocumentStatus.ARCHIVED },
  });

  logger.info('Documento archiviato per retention', { documentId: doc.id });
}

async function deleteDocumentPermanently(doc: {
  id: string;
  name: string;
  versions: Array<{ storagePath: string; fileSizeBytes: number }>;
  vault: { organizationId: string };
}) {
  // Calcola storage da liberare
  const totalSizeBytes = doc.versions.reduce((sum, v) => sum + v.fileSizeBytes, 0);
  const totalSizeMB = totalSizeBytes / (1024 * 1024);

  // Elimina file dallo storage
  for (const version of doc.versions) {
    try {
      await deleteFile(version.storagePath);
    } catch (error) {
      logger.warn('Errore eliminazione file storage', {
        storagePath: version.storagePath,
        error: (error as Error).message,
      });
    }
  }

  // Elimina record DB
  await prisma.document.delete({ where: { id: doc.id } });

  // Aggiorna storage usato
  await updateStorageUsage(doc.vault.organizationId, -totalSizeMB);

  logger.info('Documento eliminato permanentemente per retention', {
    documentId: doc.id,
    freedMB: totalSizeMB,
  });
}

// === STATISTICHE ===

export async function getRetentionStats(user: JwtPayload) {
  const now = new Date();

  // Documenti in scadenza
  const thirtyDaysFromNow = new Date();
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

  const [total, expiringSoon, expired, byPolicy] = await Promise.all([
    // Totale documenti con retention
    prisma.document.count({
      where: {
        vault: { organizationId: user.organizationId },
        retentionPolicyId: { not: null },
        deletedAt: null,
      },
    }),

    // In scadenza nei prossimi 30 giorni
    prisma.document.count({
      where: {
        vault: { organizationId: user.organizationId },
        deletedAt: null,
        retentionExpiresAt: {
          gte: now,
          lte: thirtyDaysFromNow,
        },
      },
    }),

    // Già scaduti (non ancora processati)
    prisma.document.count({
      where: {
        vault: { organizationId: user.organizationId },
        deletedAt: null,
        retentionExpiresAt: { lt: now },
      },
    }),

    // Per policy
    prisma.retentionPolicy.findMany({
      where: { organizationId: user.organizationId },
      include: {
        _count: { select: { documents: true } },
      },
    }),
  ]);

  return {
    totalWithRetention: total,
    expiringSoon,
    expired,
    byPolicy: byPolicy.map(p => ({
      id: p.id,
      name: p.name,
      action: p.action,
      documentCount: p._count.documents,
    })),
  };
}

// === DOCUMENTI IN SCADENZA ===

export async function getExpiringDocuments(
  daysAhead: number,
  user: JwtPayload
) {
  const now = new Date();
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + daysAhead);

  return prisma.document.findMany({
    where: {
      vault: { organizationId: user.organizationId },
      deletedAt: null,
      retentionExpiresAt: {
        gte: now,
        lte: futureDate,
      },
    },
    orderBy: { retentionExpiresAt: 'asc' },
    include: {
      retentionPolicy: { select: { name: true, action: true } },
      vault: { select: { name: true } },
    },
  });
}

// === CLEANUP ===

export async function closeRetentionQueue(): Promise<void> {
  if (retentionQueue) {
    await retentionQueue.close();
    retentionQueue = null;
    logger.info('Queue retention chiusa');
  }
}

// === ESEGUI MANUALMENTE ===

export async function triggerRetentionCheck(): Promise<void> {
  const queue = getRetentionQueue();
  await queue.add({}, { priority: 1 });
  logger.info('Retention check manuale accodato');
}
