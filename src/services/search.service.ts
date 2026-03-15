// Servizio Ricerca per DocuVault
// Full-text search con PostgreSQL e filtri avanzati

import { Prisma, DocumentStatus } from '@prisma/client';
import { prisma } from './prisma.service.js';
import { logger } from '../utils/logger.js';
import { PaginatedResult, JwtPayload, MetadataFilter } from '../types/index.js';

interface SearchResult {
  id: string;
  name: string;
  description: string | null;
  mimeType: string;
  status: DocumentStatus;
  createdAt: Date;
  updatedAt: Date;
  vault: {
    id: string;
    name: string;
  };
  createdBy: {
    id: string;
    firstName: string;
    lastName: string;
  };
  workflowState: {
    id: string;
    name: string;
    color: string;
  } | null;
  tags: Array<{
    tag: {
      id: string;
      name: string;
      color: string;
    };
  }>;
  currentVersion: {
    id: string;
    versionNumber: number;
    fileSizeBytes: number;
  } | null;
  // Campi di rilevanza per la ricerca
  relevanceScore?: number;
  matchedIn?: string[];
}

interface SearchParams {
  query: string;
  vaultId?: string;
  mimeTypes?: string[];
  tags?: string[];
  workflowStateId?: string;
  createdById?: string;
  createdAfter?: Date;
  createdBefore?: Date;
  metadataFilters?: MetadataFilter[];
  includeDeleted?: boolean;
  limit?: number;
  cursor?: string;
}

// === RICERCA FULL-TEXT ===

export async function searchDocuments(
  params: SearchParams,
  user: JwtPayload
): Promise<PaginatedResult<SearchResult>> {
  const limit = params.limit || 20;

  // Costruisci query di ricerca
  const searchTerms = params.query
    .trim()
    .split(/\s+/)
    .filter(term => term.length > 0)
    .map(term => `${term}:*`)
    .join(' & ');

  // Costruisci filtri WHERE
  const whereConditions: string[] = [
    `d."deletedAt" IS ${params.includeDeleted ? 'NOT NULL OR d."deletedAt" IS' : ''} NULL`,
    `v."organizationId" = $1`,
  ];

  const queryParams: unknown[] = [user.organizationId];
  let paramIndex = 2;

  // Filtro vault
  if (params.vaultId) {
    whereConditions.push(`d."vaultId" = $${paramIndex}`);
    queryParams.push(params.vaultId);
    paramIndex++;
  }

  // Filtro mime types
  if (params.mimeTypes && params.mimeTypes.length > 0) {
    whereConditions.push(`d."mimeType" = ANY($${paramIndex})`);
    queryParams.push(params.mimeTypes);
    paramIndex++;
  }

  // Filtro workflow state
  if (params.workflowStateId) {
    whereConditions.push(`d."workflowStateId" = $${paramIndex}`);
    queryParams.push(params.workflowStateId);
    paramIndex++;
  }

  // Filtro creatore
  if (params.createdById) {
    whereConditions.push(`d."createdById" = $${paramIndex}`);
    queryParams.push(params.createdById);
    paramIndex++;
  }

  // Filtro date
  if (params.createdAfter) {
    whereConditions.push(`d."createdAt" >= $${paramIndex}`);
    queryParams.push(params.createdAfter);
    paramIndex++;
  }

  if (params.createdBefore) {
    whereConditions.push(`d."createdAt" <= $${paramIndex}`);
    queryParams.push(params.createdBefore);
    paramIndex++;
  }

  // Cursor pagination
  if (params.cursor) {
    whereConditions.push(`d.id > $${paramIndex}`);
    queryParams.push(params.cursor);
    paramIndex++;
  }

  const whereClause = whereConditions.join(' AND ');

  // Query di ricerca con ranking
  const searchQuery = `
    WITH search_results AS (
      SELECT
        d.id,
        d.name,
        d.description,
        d."mimeType",
        d.status,
        d."createdAt",
        d."updatedAt",
        d."vaultId",
        d."createdById",
        d."workflowStateId",
        d."currentVersionId",
        -- Calcolo rilevanza
        (
          COALESCE(ts_rank_cd(to_tsvector('italian', d.name), to_tsquery('italian', $${paramIndex})), 0) * 4 +
          COALESCE(ts_rank_cd(to_tsvector('italian', COALESCE(d.description, '')), to_tsquery('italian', $${paramIndex})), 0) * 2 +
          COALESCE(ts_rank_cd(to_tsvector('italian', COALESCE(dv."ocrText", '')), to_tsquery('italian', $${paramIndex})), 0) * 1
        ) as relevance_score,
        -- Identifica dove c'è match
        ARRAY_REMOVE(ARRAY[
          CASE WHEN d.name ILIKE '%' || $${paramIndex + 1} || '%' THEN 'name' END,
          CASE WHEN d.description ILIKE '%' || $${paramIndex + 1} || '%' THEN 'description' END,
          CASE WHEN dv."ocrText" ILIKE '%' || $${paramIndex + 1} || '%' THEN 'content' END
        ], NULL) as matched_in
      FROM "Document" d
      JOIN "Vault" v ON d."vaultId" = v.id
      LEFT JOIN "DocumentVersion" dv ON d."currentVersionId" = dv.id
      WHERE ${whereClause}
        AND (
          to_tsvector('italian', d.name) @@ to_tsquery('italian', $${paramIndex})
          OR to_tsvector('italian', COALESCE(d.description, '')) @@ to_tsquery('italian', $${paramIndex})
          OR to_tsvector('italian', COALESCE(dv."ocrText", '')) @@ to_tsquery('italian', $${paramIndex})
          OR d.name ILIKE '%' || $${paramIndex + 1} || '%'
          OR d.description ILIKE '%' || $${paramIndex + 1} || '%'
        )
      ORDER BY relevance_score DESC, d."createdAt" DESC
      LIMIT $${paramIndex + 2}
    )
    SELECT * FROM search_results
  `;

  queryParams.push(searchTerms); // Per ts_query
  queryParams.push(params.query); // Per ILIKE
  queryParams.push(limit + 1); // Per LIMIT

  try {
    const results = await prisma.$queryRawUnsafe<Array<{
      id: string;
      name: string;
      description: string | null;
      mimeType: string;
      status: DocumentStatus;
      createdAt: Date;
      updatedAt: Date;
      vaultId: string;
      createdById: string;
      workflowStateId: string | null;
      currentVersionId: string | null;
      relevance_score: number;
      matched_in: string[];
    }>>(searchQuery, ...queryParams);

    // Carica relazioni per i risultati
    const documentIds = results.slice(0, limit).map(r => r.id);

    if (documentIds.length === 0) {
      return { items: [], nextCursor: null, hasMore: false };
    }

    const documents = await prisma.document.findMany({
      where: { id: { in: documentIds } },
      include: {
        vault: { select: { id: true, name: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        workflowState: { select: { id: true, name: true, color: true } },
        tags: { include: { tag: { select: { id: true, name: true, color: true } } } },
        currentVersion: { select: { id: true, versionNumber: true, fileSizeBytes: true } },
      },
    });

    // Unisci risultati con score di rilevanza
    const searchResults: SearchResult[] = results.slice(0, limit).map(r => {
      const doc = documents.find(d => d.id === r.id)!;
      return {
        ...doc,
        relevanceScore: r.relevance_score,
        matchedIn: r.matched_in,
      };
    });

    const hasMore = results.length > limit;
    const nextCursor = hasMore ? searchResults[searchResults.length - 1].id : null;

    return {
      items: searchResults,
      nextCursor,
      hasMore,
    };
  } catch (error) {
    logger.error('Errore ricerca documenti', { error: (error as Error).message, params });
    throw error;
  }
}

// === RICERCA CON FILTRI METADATA ===

export async function searchWithMetadataFilters(
  params: SearchParams,
  user: JwtPayload
): Promise<PaginatedResult<SearchResult>> {
  const limit = params.limit || 20;

  // Prima esegui ricerca testuale base
  const baseResults = await searchDocuments(
    { ...params, metadataFilters: undefined, limit: 1000 },
    user
  );

  if (!params.metadataFilters || params.metadataFilters.length === 0) {
    return baseResults;
  }

  // Poi filtra per metadata
  const documentIds = baseResults.items.map(d => d.id);

  const metadataMatches = await prisma.documentMetadata.findMany({
    where: {
      documentId: { in: documentIds },
      fieldId: { in: params.metadataFilters.map(f => f.fieldId) },
    },
    include: { field: true },
  });

  // Raggruppa metadata per documento
  const metadataByDocument = new Map<string, typeof metadataMatches>();
  for (const meta of metadataMatches) {
    if (!metadataByDocument.has(meta.documentId)) {
      metadataByDocument.set(meta.documentId, []);
    }
    metadataByDocument.get(meta.documentId)!.push(meta);
  }

  // Filtra documenti che soddisfano tutti i filtri metadata
  const filteredDocuments = baseResults.items.filter(doc => {
    const docMetadata = metadataByDocument.get(doc.id) || [];

    return params.metadataFilters!.every(filter => {
      const meta = docMetadata.find(m => m.fieldId === filter.fieldId);
      if (!meta) return false;

      const value = getMetadataValue(meta);
      return evaluateMetadataFilter(value, filter.operator, filter.value);
    });
  });

  // Applica paginazione
  const startIndex = params.cursor
    ? filteredDocuments.findIndex(d => d.id === params.cursor) + 1
    : 0;

  const paginatedResults = filteredDocuments.slice(startIndex, startIndex + limit + 1);
  const hasMore = paginatedResults.length > limit;
  const items = hasMore ? paginatedResults.slice(0, -1) : paginatedResults;
  const nextCursor = hasMore ? items[items.length - 1].id : null;

  return { items, nextCursor, hasMore };
}

// === SUGGERIMENTI AUTOCOMPLETE ===

export async function getSearchSuggestions(
  query: string,
  user: JwtPayload,
  limit: number = 10
): Promise<string[]> {
  if (query.length < 2) {
    return [];
  }

  const suggestions = await prisma.document.findMany({
    where: {
      vault: { organizationId: user.organizationId },
      deletedAt: null,
      OR: [
        { name: { contains: query, mode: 'insensitive' } },
        { description: { contains: query, mode: 'insensitive' } },
      ],
    },
    select: { name: true },
    distinct: ['name'],
    take: limit,
  });

  return suggestions.map(s => s.name);
}

// === RICERCA RECENTE ===

export async function getRecentDocuments(
  user: JwtPayload,
  limit: number = 10
): Promise<SearchResult[]> {
  const documents = await prisma.document.findMany({
    where: {
      vault: { organizationId: user.organizationId },
      deletedAt: null,
    },
    orderBy: { updatedAt: 'desc' },
    take: limit,
    include: {
      vault: { select: { id: true, name: true } },
      createdBy: { select: { id: true, firstName: true, lastName: true } },
      workflowState: { select: { id: true, name: true, color: true } },
      tags: { include: { tag: { select: { id: true, name: true, color: true } } } },
      currentVersion: { select: { id: true, versionNumber: true, fileSizeBytes: true } },
    },
  });

  return documents;
}

// === DOCUMENTI IN SCADENZA ===

export async function getExpiringDocuments(
  user: JwtPayload,
  daysAhead: number = 30
): Promise<SearchResult[]> {
  const expirationDate = new Date();
  expirationDate.setDate(expirationDate.getDate() + daysAhead);

  const documents = await prisma.document.findMany({
    where: {
      vault: { organizationId: user.organizationId },
      deletedAt: null,
      retentionExpiresAt: {
        lte: expirationDate,
        gte: new Date(),
      },
    },
    orderBy: { retentionExpiresAt: 'asc' },
    include: {
      vault: { select: { id: true, name: true } },
      createdBy: { select: { id: true, firstName: true, lastName: true } },
      workflowState: { select: { id: true, name: true, color: true } },
      tags: { include: { tag: { select: { id: true, name: true, color: true } } } },
      currentVersion: { select: { id: true, versionNumber: true, fileSizeBytes: true } },
    },
  });

  return documents;
}

// === HELPER FUNCTIONS ===

function getMetadataValue(meta: {
  textValue: string | null;
  numberValue: number | null;
  dateValue: Date | null;
  booleanValue: boolean | null;
  jsonValue: unknown;
  field: { type: string };
}): unknown {
  switch (meta.field.type) {
    case 'TEXT':
    case 'SELECT':
    case 'DOCUMENT_REF':
      return meta.textValue;
    case 'NUMBER':
      return meta.numberValue;
    case 'DATE':
      return meta.dateValue;
    case 'BOOLEAN':
      return meta.booleanValue;
    case 'MULTISELECT':
      return meta.jsonValue;
    default:
      return meta.textValue;
  }
}

function evaluateMetadataFilter(
  value: unknown,
  operator: string,
  filterValue: unknown
): boolean {
  if (value === null || value === undefined) {
    return false;
  }

  switch (operator) {
    case 'eq':
      return value === filterValue;
    case 'ne':
      return value !== filterValue;
    case 'gt':
      return (value as number) > (filterValue as number);
    case 'gte':
      return (value as number) >= (filterValue as number);
    case 'lt':
      return (value as number) < (filterValue as number);
    case 'lte':
      return (value as number) <= (filterValue as number);
    case 'contains':
      return String(value).toLowerCase().includes(String(filterValue).toLowerCase());
    case 'in':
      if (Array.isArray(filterValue)) {
        return filterValue.includes(value);
      }
      if (Array.isArray(value)) {
        return value.some(v => (filterValue as unknown[]).includes(v));
      }
      return false;
    default:
      return false;
  }
}
