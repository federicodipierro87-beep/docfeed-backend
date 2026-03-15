// Controller Ricerca per DocuVault

import { Request, Response } from 'express';
import {
  searchDocuments,
  searchWithMetadataFilters,
  getSearchSuggestions,
  getRecentDocuments,
  getExpiringDocuments,
} from '../services/search.service.js';
import { asyncHandler } from '../middleware/error.middleware.js';
import { JwtPayload } from '../types/index.js';

/**
 * GET /api/search
 * Ricerca documenti full-text
 */
export const searchController = asyncHandler(async (req: Request, res: Response) => {
  const {
    q,
    vaultId,
    mimeTypes,
    tags,
    workflowStateId,
    createdById,
    createdAfter,
    createdBefore,
    includeDeleted,
    cursor,
    limit,
  } = req.query;

  if (!q || typeof q !== 'string' || q.trim().length === 0) {
    res.status(400).json({
      success: false,
      error: 'Query di ricerca richiesta',
      code: 'QUERY_REQUIRED',
    });
    return;
  }

  const result = await searchDocuments(
    {
      query: q as string,
      vaultId: vaultId as string,
      mimeTypes: mimeTypes ? (mimeTypes as string).split(',') : undefined,
      tags: tags ? (tags as string).split(',') : undefined,
      workflowStateId: workflowStateId as string,
      createdById: createdById as string,
      createdAfter: createdAfter ? new Date(createdAfter as string) : undefined,
      createdBefore: createdBefore ? new Date(createdBefore as string) : undefined,
      includeDeleted: includeDeleted === 'true',
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

/**
 * POST /api/search/advanced
 * Ricerca avanzata con filtri metadata
 */
export const advancedSearchController = asyncHandler(async (req: Request, res: Response) => {
  const {
    query,
    vaultId,
    mimeTypes,
    tags,
    workflowStateId,
    createdById,
    createdAfter,
    createdBefore,
    metadataFilters,
    cursor,
    limit,
  } = req.body;

  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    res.status(400).json({
      success: false,
      error: 'Query di ricerca richiesta',
      code: 'QUERY_REQUIRED',
    });
    return;
  }

  const result = await searchWithMetadataFilters(
    {
      query,
      vaultId,
      mimeTypes,
      tags,
      workflowStateId,
      createdById,
      createdAfter: createdAfter ? new Date(createdAfter) : undefined,
      createdBefore: createdBefore ? new Date(createdBefore) : undefined,
      metadataFilters,
      cursor,
      limit,
    },
    req.user as JwtPayload
  );

  res.json({
    success: true,
    data: result,
  });
});

/**
 * GET /api/search/suggestions
 * Suggerimenti autocomplete
 */
export const suggestionsController = asyncHandler(async (req: Request, res: Response) => {
  const { q, limit } = req.query;

  if (!q || typeof q !== 'string') {
    res.json({
      success: true,
      data: [],
    });
    return;
  }

  const suggestions = await getSearchSuggestions(
    q,
    req.user as JwtPayload,
    limit ? parseInt(limit as string) : undefined
  );

  res.json({
    success: true,
    data: suggestions,
  });
});

/**
 * GET /api/search/recent
 * Documenti recenti
 */
export const recentController = asyncHandler(async (req: Request, res: Response) => {
  const { limit } = req.query;

  const documents = await getRecentDocuments(
    req.user as JwtPayload,
    limit ? parseInt(limit as string) : undefined
  );

  res.json({
    success: true,
    data: documents,
  });
});

/**
 * GET /api/search/expiring
 * Documenti in scadenza retention
 */
export const expiringController = asyncHandler(async (req: Request, res: Response) => {
  const { days } = req.query;

  const documents = await getExpiringDocuments(
    req.user as JwtPayload,
    days ? parseInt(days as string) : undefined
  );

  res.json({
    success: true,
    data: documents,
  });
});
