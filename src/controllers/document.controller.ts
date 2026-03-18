// Controller Documenti per DocuVault

import { Request, Response } from 'express';
import {
  createDocument,
  getDocument,
  listDocuments,
  updateDocument,
  createDocumentVersion,
  checkoutDocument,
  checkinDocument,
  deleteDocument,
  restoreDocument,
  permanentDeleteDocument,
  getDocumentDownloadUrl,
  generateEmailFile,
} from '../services/document.service.js';
import { getAvailableTransitions, transitionDocument } from '../services/workflow.service.js';
import { getDocumentAuditLogs } from '../services/audit.service.js';
import { asyncHandler } from '../middleware/error.middleware.js';
import { prisma } from '../services/prisma.service.js';
import { JwtPayload } from '../types/index.js';

/**
 * POST /api/documents
 * Crea nuovo documento con upload file
 */
export const createDocumentController = asyncHandler(async (req: Request, res: Response) => {
  const { name, description, vaultId, workflowId, retentionPolicyId, tags, metadata } = req.body;

  if (!req.file) {
    res.status(400).json({
      success: false,
      error: 'File richiesto',
      code: 'FILE_REQUIRED',
    });
    return;
  }

  // Parse metadata se è una stringa JSON
  let parsedMetadata = metadata;
  if (typeof metadata === 'string') {
    try {
      parsedMetadata = JSON.parse(metadata);
    } catch {
      parsedMetadata = undefined;
    }
  }

  // Parse tags se è una stringa JSON
  let parsedTags = tags;
  if (typeof tags === 'string') {
    try {
      parsedTags = JSON.parse(tags);
    } catch {
      parsedTags = undefined;
    }
  }

  const document = await createDocument(
    {
      name,
      description,
      vaultId,
      workflowId,
      retentionPolicyId,
      tags: parsedTags,
      metadata: parsedMetadata,
    },
    {
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
      originalName: req.file.originalname,
    },
    req.user as JwtPayload
  );

  res.status(201).json({
    success: true,
    data: document,
  });
});

/**
 * GET /api/documents
 * Lista documenti con filtri e paginazione
 */
export const listDocumentsController = asyncHandler(async (req: Request, res: Response) => {
  const {
    vaultId,
    status,
    mimeType,
    tags,
    workflowStateId,
    createdById,
    createdAfter,
    createdBefore,
    search,
    cursor,
    limit,
    sortBy,
    sortOrder,
  } = req.query;

  const result = await listDocuments(
    {
      vaultId: vaultId as string,
      status: status as string,
      mimeType: mimeType as string,
      tags: tags ? (tags as string).split(',') : undefined,
      workflowStateId: workflowStateId as string,
      createdById: createdById as string,
      createdAfter: createdAfter ? new Date(createdAfter as string) : undefined,
      createdBefore: createdBefore ? new Date(createdBefore as string) : undefined,
      search: search as string,
    },
    {
      cursor: cursor as string,
      limit: limit ? parseInt(limit as string) : undefined,
      sortBy: sortBy as string,
      sortOrder: sortOrder as 'asc' | 'desc',
    },
    req.user as JwtPayload
  );

  res.json({
    success: true,
    data: result,
  });
});

/**
 * GET /api/documents/:id
 * Dettaglio documento
 */
export const getDocumentController = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const document = await getDocument(id, req.user as JwtPayload);

  res.json({
    success: true,
    data: document,
  });
});

/**
 * PATCH /api/documents/:id
 * Aggiorna documento
 */
export const updateDocumentController = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const updates = req.body;

  const document = await updateDocument(id, updates, req.user as JwtPayload);

  res.json({
    success: true,
    data: document,
  });
});

/**
 * DELETE /api/documents/:id
 * Elimina documento (soft delete)
 */
export const deleteDocumentController = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  await deleteDocument(id, req.user as JwtPayload);

  res.json({
    success: true,
    message: 'Documento spostato nel cestino',
  });
});

/**
 * POST /api/documents/:id/restore
 * Ripristina documento dal cestino
 */
export const restoreDocumentController = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const document = await restoreDocument(id, req.user as JwtPayload);

  res.json({
    success: true,
    data: document,
  });
});

/**
 * DELETE /api/documents/:id/permanent
 * Elimina documento permanentemente
 */
export const permanentDeleteController = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  await permanentDeleteDocument(id, req.user as JwtPayload);

  res.json({
    success: true,
    message: 'Documento eliminato permanentemente',
  });
});

// === VERSIONING ===

/**
 * POST /api/documents/:id/versions
 * Crea nuova versione documento
 */
export const createVersionController = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { comment } = req.body;

  if (!req.file) {
    res.status(400).json({
      success: false,
      error: 'File richiesto',
      code: 'FILE_REQUIRED',
    });
    return;
  }

  const version = await createDocumentVersion(
    id,
    {
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
      originalName: req.file.originalname,
    },
    comment,
    req.user as JwtPayload
  );

  res.status(201).json({
    success: true,
    data: version,
  });
});

/**
 * GET /api/documents/:id/versions
 * Lista versioni documento
 */
export const listVersionsController = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  // Verifica accesso al documento
  await getDocument(id, req.user as JwtPayload);

  const versions = await prisma.documentVersion.findMany({
    where: { documentId: id },
    orderBy: { versionNumber: 'desc' },
    include: {
      createdBy: {
        select: { id: true, firstName: true, lastName: true },
      },
    },
  });

  res.json({
    success: true,
    data: versions,
  });
});

// === CHECKOUT / CHECKIN ===

/**
 * POST /api/documents/:id/checkout
 * Checkout documento
 */
export const checkoutController = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const document = await checkoutDocument(id, req.user as JwtPayload);

  res.json({
    success: true,
    data: document,
    message: 'Documento in checkout',
  });
});

/**
 * POST /api/documents/:id/checkin
 * Checkin documento
 */
export const checkinController = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { comment } = req.body;

  const file = req.file
    ? {
        buffer: req.file.buffer,
        mimeType: req.file.mimetype,
        originalName: req.file.originalname,
      }
    : null;

  const document = await checkinDocument(id, file, comment, req.user as JwtPayload);

  res.json({
    success: true,
    data: document,
    message: file ? 'Nuova versione creata' : 'Checkout rilasciato',
  });
});

// === DOWNLOAD ===

/**
 * GET /api/documents/:id/download
 * Ottieni URL download
 */
export const downloadController = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { versionId } = req.query;

  const { url, filename } = await getDocumentDownloadUrl(
    id,
    versionId as string | undefined,
    req.user as JwtPayload
  );

  res.json({
    success: true,
    data: { url, filename },
  });
});

/**
 * GET /api/documents/:id/email
 * Genera file .eml con documento allegato
 */
export const emailController = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const { emlContent, filename } = await generateEmailFile(
    id,
    req.user as JwtPayload
  );

  res.setHeader('Content-Type', 'message/rfc822');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(emlContent);
});

// === WORKFLOW ===

/**
 * GET /api/documents/:id/transitions
 * Transizioni workflow disponibili
 */
export const getTransitionsController = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const transitions = await getAvailableTransitions(id, req.user as JwtPayload);

  res.json({
    success: true,
    data: transitions,
  });
});

/**
 * POST /api/documents/:id/transition
 * Esegui transizione workflow
 */
export const transitionController = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { toStateId, comment } = req.body;

  await transitionDocument(id, toStateId, comment, req.user as JwtPayload);

  res.json({
    success: true,
    message: 'Transizione completata',
  });
});

// === AUDIT ===

/**
 * GET /api/documents/:id/audit
 * Cronologia audit documento
 */
export const getAuditController = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { cursor, limit } = req.query;

  const result = await getDocumentAuditLogs(
    id,
    {
      cursor: cursor as string,
      limit: limit ? parseInt(limit as string) : undefined,
    },
    req.user as JwtPayload
  );

  res.json({
    success: true,
    data: result,
  });
});

// === CESTINO ===

/**
 * GET /api/documents/trash
 * Lista documenti nel cestino
 */
export const listTrashController = asyncHandler(async (req: Request, res: Response) => {
  const { cursor, limit } = req.query;

  const documents = await prisma.document.findMany({
    where: {
      vault: { organizationId: req.user!.organizationId },
      deletedAt: { not: null },
    },
    take: limit ? parseInt(limit as string) + 1 : 21,
    ...(cursor && { cursor: { id: cursor as string }, skip: 1 }),
    orderBy: { deletedAt: 'desc' },
    include: {
      vault: { select: { id: true, name: true } },
      createdBy: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  const pageLimit = limit ? parseInt(limit as string) : 20;
  const hasMore = documents.length > pageLimit;
  const items = hasMore ? documents.slice(0, -1) : documents;
  const nextCursor = hasMore ? items[items.length - 1].id : null;

  res.json({
    success: true,
    data: { items, nextCursor, hasMore },
  });
});
