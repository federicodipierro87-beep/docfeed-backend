// Servizio Documenti per DocuVault
// CRUD, versioning, permessi e gestione completa documenti

import { Document, DocumentStatus, DocumentVersion, Prisma, PermissionType } from '@prisma/client';
import { prisma } from './prisma.service.js';
import {
  uploadFile,
  deleteFile,
  downloadFile,
  getDownloadUrl,
  generateStoragePath,
} from './storage.service.js';
import { updateStorageUsage, checkStorageLimit } from './license.service.js';
import { createAuditLog } from './audit.service.js';
import { queueOCRJob } from './ocr.service.js';
import { generateChecksum } from '../utils/crypto.js';
import { logger } from '../utils/logger.js';
import {
  DocumentFilters,
  PaginationParams,
  PaginatedResult,
  NotFoundError,
  AuthorizationError,
  ConflictError,
  LicenseError,
  JwtPayload,
} from '../types/index.js';

// === CREAZIONE DOCUMENTO ===

export async function createDocument(
  data: {
    name: string;
    description?: string;
    vaultId: string;
    workflowId?: string;
    retentionPolicyId?: string;
    tags?: string[];
    metadata?: Array<{ fieldId: string; value: unknown }>;
  },
  file: { buffer: Buffer; mimeType: string; originalName: string },
  user: JwtPayload
): Promise<Document> {
  // Verifica limiti storage
  const fileSizeMB = file.buffer.length / (1024 * 1024);
  const canUpload = await checkStorageLimit(user.organizationId, fileSizeMB);

  if (!canUpload) {
    throw new LicenseError('Limite storage raggiunto');
  }

  // Verifica vault appartenga all'organizzazione
  const vault = await prisma.vault.findFirst({
    where: {
      id: data.vaultId,
      organizationId: user.organizationId,
    },
  });

  if (!vault) {
    throw new NotFoundError('Vault');
  }

  // Transazione per creare documento e versione
  const document = await prisma.$transaction(async (tx) => {
    // Crea documento
    const doc = await tx.document.create({
      data: {
        name: data.name,
        description: data.description,
        mimeType: file.mimeType,
        status: DocumentStatus.ACTIVE,
        vaultId: data.vaultId,
        createdById: user.userId,
        workflowId: data.workflowId,
        retentionPolicyId: data.retentionPolicyId,
      },
    });

    // Genera path storage
    const storagePath = generateStoragePath(
      user.organizationId,
      data.vaultId,
      doc.id,
      1,
      file.originalName
    );

    // Upload file
    const uploadResult = await uploadFile(file.buffer, storagePath, file.mimeType);

    // Crea prima versione
    const version = await tx.documentVersion.create({
      data: {
        versionNumber: 1,
        documentId: doc.id,
        storagePath,
        fileSizeBytes: uploadResult.size,
        checksum: uploadResult.checksum,
        createdById: user.userId,
      },
    });

    // Aggiorna documento con versione corrente
    const updatedDoc = await tx.document.update({
      where: { id: doc.id },
      data: { currentVersionId: version.id },
    });

    // Aggiungi tags
    if (data.tags && data.tags.length > 0) {
      await tx.documentTag.createMany({
        data: data.tags.map((tagId) => ({
          documentId: doc.id,
          tagId,
        })),
      });
    }

    // Aggiungi metadata
    if (data.metadata && data.metadata.length > 0) {
      for (const meta of data.metadata) {
        await setDocumentMetadata(tx, doc.id, meta.fieldId, meta.value, user.userId);
      }
    }

    // Imposta stato workflow iniziale
    if (data.workflowId) {
      const initialState = await tx.workflowStateDefinition.findFirst({
        where: { workflowId: data.workflowId, isInitial: true },
      });

      if (initialState) {
        await tx.document.update({
          where: { id: doc.id },
          data: { workflowStateId: initialState.id },
        });
      }
    }

    return updatedDoc;
  });

  // Aggiorna storage usato
  await updateStorageUsage(user.organizationId, fileSizeMB);

  // Crea audit log
  await createAuditLog({
    action: 'CREATE',
    entityType: 'Document',
    entityId: document.id,
    documentId: document.id,
  }, user);

  // Accoda job OCR se abilitato
  if (process.env.OCR_ENABLED === 'true') {
    await queueOCRJob(document.id);
  }

  logger.info('Documento creato', { documentId: document.id, userId: user.userId });

  return document;
}

// === LETTURA DOCUMENTO ===

export async function getDocument(
  documentId: string,
  user: JwtPayload
): Promise<Document & { currentVersion: DocumentVersion | null }> {
  const document = await prisma.document.findFirst({
    where: {
      id: documentId,
      vault: { organizationId: user.organizationId },
      deletedAt: null,
    },
    include: {
      currentVersion: true,
      vault: true,
      createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
      workflowState: true,
      tags: { include: { tag: true } },
      metadata: { include: { field: true } },
    },
  });

  if (!document) {
    throw new NotFoundError('Documento');
  }

  // Verifica permessi (proprietario, admin o permesso esplicito)
  const hasAccess = await checkDocumentAccess(documentId, user.userId, user.role, 'READ');
  if (!hasAccess) {
    throw new AuthorizationError('Accesso al documento negato');
  }

  // Audit log
  await createAuditLog({
    action: 'VIEW',
    entityType: 'Document',
    entityId: documentId,
    documentId,
  }, user);

  return document;
}

// === LISTA DOCUMENTI ===

export async function listDocuments(
  filters: DocumentFilters,
  pagination: PaginationParams,
  user: JwtPayload
): Promise<PaginatedResult<Document>> {
  const limit = pagination.limit || 20;

  const where: Prisma.DocumentWhereInput = {
    vault: { organizationId: user.organizationId },
    deletedAt: null,
    ...(filters.vaultId && { vaultId: filters.vaultId }),
    ...(filters.status && { status: filters.status as DocumentStatus }),
    ...(filters.mimeType && { mimeType: { contains: filters.mimeType } }),
    ...(filters.workflowStateId && { workflowStateId: filters.workflowStateId }),
    ...(filters.createdById && { createdById: filters.createdById }),
    ...(filters.createdAfter && { createdAt: { gte: filters.createdAfter } }),
    ...(filters.createdBefore && { createdAt: { lte: filters.createdBefore } }),
    ...(filters.tags && filters.tags.length > 0 && {
      tags: { some: { tagId: { in: filters.tags } } },
    }),
    ...(filters.search && {
      OR: [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { description: { contains: filters.search, mode: 'insensitive' } },
      ],
    }),
  };

  // Cursor-based pagination
  const documents = await prisma.document.findMany({
    where,
    take: limit + 1,
    orderBy: {
      [pagination.sortBy || 'createdAt']: pagination.sortOrder || 'desc',
    },
    include: {
      currentVersion: { select: { id: true, versionNumber: true, fileSizeBytes: true } },
      vault: { select: { id: true, name: true } },
      createdBy: { select: { id: true, firstName: true, lastName: true } },
      workflowState: { select: { id: true, name: true, color: true } },
      tags: { include: { tag: { select: { id: true, name: true, color: true } } } },
    },
    ...(pagination.cursor && { cursor: { id: pagination.cursor }, skip: 1 }),
  });

  const hasMore = documents.length > limit;
  const items = hasMore ? documents.slice(0, -1) : documents;
  const nextCursor = hasMore ? items[items.length - 1].id : null;

  return {
    items,
    nextCursor,
    hasMore,
  };
}

// === AGGIORNAMENTO DOCUMENTO ===

export async function updateDocument(
  documentId: string,
  data: {
    name?: string;
    description?: string;
    vaultId?: string;
    workflowId?: string | null;
    retentionPolicyId?: string | null;
    tags?: string[];
    metadata?: Array<{ fieldId: string; value: unknown }>;
  },
  user: JwtPayload
): Promise<Document> {
  // Verifica documento esiste
  const existing = await prisma.document.findFirst({
    where: {
      id: documentId,
      vault: { organizationId: user.organizationId },
      deletedAt: null,
    },
  });

  if (!existing) {
    throw new NotFoundError('Documento');
  }

  // Verifica permessi
  const hasAccess = await checkDocumentAccess(documentId, user.userId, user.role, 'WRITE');
  if (!hasAccess) {
    throw new AuthorizationError('Modifica documento non autorizzata');
  }

  // Verifica checkout
  if (existing.checkedOutById && existing.checkedOutById !== user.userId) {
    throw new ConflictError('Documento in checkout da un altro utente');
  }

  const document = await prisma.$transaction(async (tx) => {
    // Aggiorna documento
    const doc = await tx.document.update({
      where: { id: documentId },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.vaultId && { vaultId: data.vaultId }),
        ...(data.workflowId !== undefined && { workflowId: data.workflowId }),
        ...(data.retentionPolicyId !== undefined && { retentionPolicyId: data.retentionPolicyId }),
      },
    });

    // Aggiorna tags
    if (data.tags !== undefined) {
      await tx.documentTag.deleteMany({ where: { documentId } });

      if (data.tags.length > 0) {
        await tx.documentTag.createMany({
          data: data.tags.map((tagId) => ({ documentId, tagId })),
        });
      }
    }

    // Aggiorna metadata
    if (data.metadata) {
      for (const meta of data.metadata) {
        if (meta.value === null) {
          await tx.documentMetadata.deleteMany({
            where: { documentId, fieldId: meta.fieldId },
          });
        } else {
          await setDocumentMetadata(tx, documentId, meta.fieldId, meta.value, user.userId);
        }
      }
    }

    return doc;
  });

  // Audit log
  await createAuditLog({
    action: 'EDIT',
    entityType: 'Document',
    entityId: documentId,
    documentId,
    details: { changes: data },
  }, user);

  return document;
}

// === NUOVA VERSIONE ===

export async function createDocumentVersion(
  documentId: string,
  file: { buffer: Buffer; mimeType: string; originalName: string },
  comment: string | undefined,
  user: JwtPayload
): Promise<DocumentVersion> {
  // Verifica documento esiste
  const document = await prisma.document.findFirst({
    where: {
      id: documentId,
      vault: { organizationId: user.organizationId },
      deletedAt: null,
    },
    include: {
      vault: true,
      versions: { orderBy: { versionNumber: 'desc' }, take: 1 },
    },
  });

  if (!document) {
    throw new NotFoundError('Documento');
  }

  // Verifica permessi
  const hasAccess = await checkDocumentAccess(documentId, user.userId, user.role, 'WRITE');
  if (!hasAccess) {
    throw new AuthorizationError('Creazione versione non autorizzata');
  }

  // Verifica checkout (deve essere in checkout dall'utente corrente o nessun checkout)
  if (document.checkedOutById && document.checkedOutById !== user.userId) {
    throw new ConflictError('Documento in checkout da un altro utente');
  }

  // Verifica limiti storage
  const fileSizeMB = file.buffer.length / (1024 * 1024);
  const canUpload = await checkStorageLimit(user.organizationId, fileSizeMB);

  if (!canUpload) {
    throw new LicenseError('Limite storage raggiunto');
  }

  const nextVersionNumber = (document.versions[0]?.versionNumber || 0) + 1;

  // Genera path storage
  const storagePath = generateStoragePath(
    user.organizationId,
    document.vaultId,
    documentId,
    nextVersionNumber,
    file.originalName
  );

  // Upload file
  const uploadResult = await uploadFile(file.buffer, storagePath, file.mimeType);

  // Crea versione
  const version = await prisma.$transaction(async (tx) => {
    const ver = await tx.documentVersion.create({
      data: {
        versionNumber: nextVersionNumber,
        documentId,
        storagePath,
        fileSizeBytes: uploadResult.size,
        checksum: uploadResult.checksum,
        comment,
        createdById: user.userId,
      },
    });

    // Aggiorna documento con nuova versione corrente
    await tx.document.update({
      where: { id: documentId },
      data: {
        currentVersionId: ver.id,
        mimeType: file.mimeType,
        // Rilascia checkout automaticamente
        checkedOutById: null,
        checkedOutAt: null,
      },
    });

    return ver;
  });

  // Aggiorna storage usato
  await updateStorageUsage(user.organizationId, fileSizeMB);

  // Audit log
  await createAuditLog({
    action: 'VERSION_CREATE',
    entityType: 'DocumentVersion',
    entityId: version.id,
    documentId,
    details: { versionNumber: nextVersionNumber, comment },
  }, user);

  // Accoda job OCR
  if (process.env.OCR_ENABLED === 'true') {
    await queueOCRJob(documentId, version.id);
  }

  logger.info('Nuova versione documento', { documentId, versionNumber: nextVersionNumber });

  return version;
}

// === CHECKOUT / CHECKIN ===

export async function checkoutDocument(documentId: string, user: JwtPayload): Promise<Document> {
  const document = await prisma.document.findFirst({
    where: {
      id: documentId,
      vault: { organizationId: user.organizationId },
      deletedAt: null,
    },
  });

  if (!document) {
    throw new NotFoundError('Documento');
  }

  // Verifica permessi
  const hasAccess = await checkDocumentAccess(documentId, user.userId, user.role, 'WRITE');
  if (!hasAccess) {
    throw new AuthorizationError('Checkout non autorizzato');
  }

  if (document.checkedOutById) {
    if (document.checkedOutById === user.userId) {
      throw new ConflictError('Documento già in checkout');
    }
    throw new ConflictError('Documento in checkout da un altro utente');
  }

  const updated = await prisma.document.update({
    where: { id: documentId },
    data: {
      checkedOutById: user.userId,
      checkedOutAt: new Date(),
    },
  });

  await createAuditLog({
    action: 'CHECKOUT',
    entityType: 'Document',
    entityId: documentId,
    documentId,
  }, user);

  return updated;
}

export async function checkinDocument(
  documentId: string,
  file: { buffer: Buffer; mimeType: string; originalName: string } | null,
  comment: string | undefined,
  user: JwtPayload
): Promise<Document> {
  const document = await prisma.document.findFirst({
    where: {
      id: documentId,
      vault: { organizationId: user.organizationId },
      deletedAt: null,
    },
  });

  if (!document) {
    throw new NotFoundError('Documento');
  }

  if (document.checkedOutById !== user.userId) {
    throw new ConflictError('Documento non in checkout o in checkout da altro utente');
  }

  // Se c'è un file, crea nuova versione
  if (file) {
    await createDocumentVersion(documentId, file, comment, user);
  } else {
    // Altrimenti rilascia solo il checkout
    await prisma.document.update({
      where: { id: documentId },
      data: {
        checkedOutById: null,
        checkedOutAt: null,
      },
    });
  }

  await createAuditLog({
    action: 'CHECKIN',
    entityType: 'Document',
    entityId: documentId,
    documentId,
    details: { hasNewVersion: !!file, comment },
  }, user);

  return prisma.document.findUniqueOrThrow({ where: { id: documentId } });
}

// === ELIMINAZIONE (SOFT DELETE) ===

export async function deleteDocument(documentId: string, user: JwtPayload): Promise<void> {
  const document = await prisma.document.findFirst({
    where: {
      id: documentId,
      vault: { organizationId: user.organizationId },
      deletedAt: null,
    },
  });

  if (!document) {
    throw new NotFoundError('Documento');
  }

  // Verifica permessi
  const hasAccess = await checkDocumentAccess(documentId, user.userId, user.role, 'DELETE');
  if (!hasAccess) {
    throw new AuthorizationError('Eliminazione documento non autorizzata');
  }

  if (document.checkedOutById) {
    throw new ConflictError('Impossibile eliminare documento in checkout');
  }

  await prisma.document.update({
    where: { id: documentId },
    data: {
      status: DocumentStatus.DELETED,
      deletedAt: new Date(),
    },
  });

  await createAuditLog({
    action: 'DELETE',
    entityType: 'Document',
    entityId: documentId,
    documentId,
  }, user);

  logger.info('Documento eliminato (soft)', { documentId });
}

// === RIPRISTINO ===

export async function restoreDocument(documentId: string, user: JwtPayload): Promise<Document> {
  const document = await prisma.document.findFirst({
    where: {
      id: documentId,
      vault: { organizationId: user.organizationId },
      deletedAt: { not: null },
    },
  });

  if (!document) {
    throw new NotFoundError('Documento');
  }

  // Solo admin può ripristinare
  if (user.role !== 'ADMIN' && user.role !== 'MANAGER') {
    throw new AuthorizationError('Solo Admin e Manager possono ripristinare documenti');
  }

  const restored = await prisma.document.update({
    where: { id: documentId },
    data: {
      status: DocumentStatus.ACTIVE,
      deletedAt: null,
    },
  });

  await createAuditLog({
    action: 'RESTORE',
    entityType: 'Document',
    entityId: documentId,
    documentId,
  }, user);

  return restored;
}

// === ELIMINAZIONE PERMANENTE ===

export async function permanentDeleteDocument(documentId: string, user: JwtPayload): Promise<void> {
  const document = await prisma.document.findFirst({
    where: {
      id: documentId,
      vault: { organizationId: user.organizationId },
    },
    include: { versions: true },
  });

  if (!document) {
    throw new NotFoundError('Documento');
  }

  // Solo admin può eliminare permanentemente
  if (user.role !== 'ADMIN') {
    throw new AuthorizationError('Solo Admin può eliminare permanentemente');
  }

  // Calcola storage da liberare
  const totalSizeBytes = document.versions.reduce((sum, v) => sum + v.fileSizeBytes, 0);
  const totalSizeMB = totalSizeBytes / (1024 * 1024);

  // Elimina file dallo storage
  for (const version of document.versions) {
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
  await prisma.document.delete({ where: { id: documentId } });

  // Aggiorna storage usato
  await updateStorageUsage(user.organizationId, -totalSizeMB);

  logger.info('Documento eliminato permanentemente', { documentId, freedMB: totalSizeMB });
}

// === DOWNLOAD ===

export async function getDocumentDownloadUrl(
  documentId: string,
  versionId: string | undefined,
  user: JwtPayload
): Promise<{ url: string; filename: string }> {
  const document = await prisma.document.findFirst({
    where: {
      id: documentId,
      vault: { organizationId: user.organizationId },
      deletedAt: null,
    },
    include: {
      currentVersion: true,
      versions: versionId ? { where: { id: versionId } } : undefined,
    },
  });

  if (!document) {
    throw new NotFoundError('Documento');
  }

  // Verifica permessi
  const hasAccess = await checkDocumentAccess(documentId, user.userId, user.role, 'READ');
  if (!hasAccess) {
    throw new AuthorizationError('Download non autorizzato');
  }

  const version = versionId
    ? document.versions[0]
    : document.currentVersion;

  if (!version) {
    throw new NotFoundError('Versione documento');
  }

  const url = await getDownloadUrl(version.storagePath, 3600);

  // Audit log
  await createAuditLog({
    action: 'DOWNLOAD',
    entityType: 'Document',
    entityId: documentId,
    documentId,
    details: { versionId: version.id, versionNumber: version.versionNumber },
  }, user);

  const extension = version.storagePath.split('.').pop() || 'bin';
  const filename = `${document.name}_v${version.versionNumber}.${extension}`;

  return { url, filename };
}

/**
 * Genera un file .eml con il documento allegato
 */
export async function generateEmailFile(
  documentId: string,
  user: JwtPayload
): Promise<{ emlContent: string; filename: string }> {
  const document = await prisma.document.findFirst({
    where: {
      id: documentId,
      vault: { organizationId: user.organizationId },
      deletedAt: null,
    },
    include: {
      currentVersion: true,
    },
  });

  if (!document) {
    throw new NotFoundError('Documento');
  }

  // Verifica permessi
  const hasAccess = await checkDocumentAccess(documentId, user.userId, user.role, 'READ');
  if (!hasAccess) {
    throw new AuthorizationError('Download non autorizzato');
  }

  const version = document.currentVersion;
  if (!version) {
    throw new NotFoundError('Versione documento');
  }

  // Scarica il file dallo storage
  const fileBuffer = await downloadFile(version.storagePath);
  const base64Content = fileBuffer.toString('base64');

  // Crea il contenuto .eml
  const boundary = '----=_Part_0_' + Date.now();
  const emlContent = [
    'MIME-Version: 1.0',
    `Subject: ${document.name}`,
    'X-Unsent: 1',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    `In allegato: ${document.name}`,
    '',
    `--${boundary}`,
    `Content-Type: ${document.mimeType}; name="${document.name}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${document.name}"`,
    '',
    base64Content,
    `--${boundary}--`,
  ].join('\r\n');

  return { emlContent, filename: `${document.name}.eml` };
}

// === HELPER FUNCTIONS ===

async function checkDocumentAccess(
  documentId: string,
  userId: string,
  userRole: string,
  requiredPermission: PermissionType | 'READ' | 'WRITE' | 'DELETE'
): Promise<boolean> {
  // Admin hanno sempre accesso
  if (userRole === 'ADMIN') {
    return true;
  }

  // Controlla se è il creatore
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: { createdById: true },
  });

  if (document?.createdById === userId) {
    return true;
  }

  // Manager hanno accesso a tutto tranne DELETE permanente
  if (userRole === 'MANAGER' && requiredPermission !== 'DELETE') {
    return true;
  }

  // Controlla permessi espliciti
  const permission = await prisma.documentPermission.findFirst({
    where: {
      documentId,
      userId,
      permission: requiredPermission as PermissionType,
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ],
    },
  });

  return !!permission;
}

async function setDocumentMetadata(
  tx: Prisma.TransactionClient,
  documentId: string,
  fieldId: string,
  value: unknown,
  userId: string
): Promise<void> {
  const field = await tx.metadataField.findUnique({
    where: { id: fieldId },
  });

  if (!field) {
    throw new NotFoundError('Campo metadata');
  }

  const metadataData: Prisma.DocumentMetadataUncheckedCreateInput = {
    documentId,
    fieldId,
    textValue: undefined,
    numberValue: undefined,
    dateValue: undefined,
    booleanValue: undefined,
    jsonValue: undefined,
    userRefId: undefined,
  };

  switch (field.type) {
    case 'TEXT':
    case 'SELECT':
      metadataData.textValue = String(value);
      break;
    case 'NUMBER':
      metadataData.numberValue = Number(value);
      break;
    case 'DATE':
      metadataData.dateValue = new Date(value as string);
      break;
    case 'BOOLEAN':
      metadataData.booleanValue = Boolean(value);
      break;
    case 'MULTISELECT':
      metadataData.jsonValue = value as Prisma.InputJsonValue;
      break;
    case 'USER':
      metadataData.userRefId = String(value);
      break;
    case 'DOCUMENT_REF':
      metadataData.textValue = String(value);
      break;
  }

  await tx.documentMetadata.upsert({
    where: {
      documentId_fieldId: { documentId, fieldId },
    },
    create: metadataData,
    update: metadataData,
  });
}
