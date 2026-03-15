// Tipi condivisi per DocuVault Backend

import { User, UserRole, LicensePlan, PermissionType, AuditAction } from '@prisma/client';

// === AUTENTICAZIONE ===

export interface JwtPayload {
  userId: string;
  email: string;
  role: UserRole;
  organizationId: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface AuthenticatedRequest {
  user: JwtPayload;
}

// === LICENZE ===

export type LicenseFeature =
  | 'ocr'
  | 'workflow'
  | 'audit_log'
  | 'retention'
  | 'api_access'
  | 'custom_metadata'
  | 'advanced_search'
  | 'bulk_operations'
  | 'integrations';

export interface LicenseInfo {
  plan: LicensePlan;
  maxUsers: number;
  maxStorageGB: number;
  features: LicenseFeature[];
  validUntil: Date;
  isValid: boolean;
  currentUsers: number;
  currentStorageGB: number;
}

export const PLAN_FEATURES: Record<LicensePlan, LicenseFeature[]> = {
  BASE: ['custom_metadata'],
  TEAM: ['custom_metadata', 'ocr', 'audit_log'],
  BUSINESS: ['custom_metadata', 'ocr', 'audit_log', 'workflow', 'retention', 'advanced_search'],
  ENTERPRISE: [
    'custom_metadata',
    'ocr',
    'audit_log',
    'workflow',
    'retention',
    'advanced_search',
    'api_access',
    'bulk_operations',
    'integrations',
  ],
};

export const PLAN_LIMITS: Record<LicensePlan, { maxUsers: number; maxStorageGB: number }> = {
  BASE: { maxUsers: 5, maxStorageGB: 10 },
  TEAM: { maxUsers: 25, maxStorageGB: 100 },
  BUSINESS: { maxUsers: 100, maxStorageGB: 1000 },
  ENTERPRISE: { maxUsers: -1, maxStorageGB: -1 }, // Illimitato
};

// === STORAGE ===

export interface StorageProvider {
  uploadFile(key: string, buffer: Buffer, mimeType: string): Promise<void>;
  downloadFile(key: string): Promise<Buffer>;
  deleteFile(key: string): Promise<void>;
  getPresignedUploadUrl(key: string, mimeType: string, expiresIn?: number): Promise<string>;
  getPresignedDownloadUrl(key: string, expiresIn?: number): Promise<string>;
  fileExists(key: string): Promise<boolean>;
}

export interface UploadResult {
  key: string;
  size: number;
  checksum: string;
}

// === DOCUMENTI ===

export interface DocumentFilters {
  vaultId?: string;
  status?: string;
  mimeType?: string;
  tags?: string[];
  workflowStateId?: string;
  createdById?: string;
  createdAfter?: Date;
  createdBefore?: Date;
  search?: string;
  metadataFilters?: MetadataFilter[];
}

export interface MetadataFilter {
  fieldId: string;
  operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'in';
  value: string | number | boolean | Date | string[];
}

export interface PaginationParams {
  cursor?: string;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface PaginatedResult<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
  total?: number;
}

// === WORKFLOW ===

export interface WorkflowTransitionRequest {
  documentId: string;
  toStateId: string;
  comment?: string;
}

// === AUDIT ===

export interface AuditLogEntry {
  action: AuditAction;
  entityType: string;
  entityId: string;
  documentId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

// === API RESPONSES ===

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

// === ERRORI PERSONALIZZATI ===

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(400, 'VALIDATION_ERROR', message, details);
    this.name = 'ValidationError';
  }
}

export class AuthenticationError extends AppError {
  constructor(message: string = 'Autenticazione richiesta') {
    super(401, 'AUTHENTICATION_ERROR', message);
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends AppError {
  constructor(message: string = 'Permessi insufficienti') {
    super(403, 'AUTHORIZATION_ERROR', message);
    this.name = 'AuthorizationError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(404, 'NOT_FOUND', `${resource} non trovato`);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, 'CONFLICT', message);
    this.name = 'ConflictError';
  }
}

export class LicenseError extends AppError {
  constructor(message: string) {
    super(403, 'LICENSE_ERROR', message);
    this.name = 'LicenseError';
  }
}

export class StorageError extends AppError {
  constructor(message: string) {
    super(500, 'STORAGE_ERROR', message);
    this.name = 'StorageError';
  }
}
