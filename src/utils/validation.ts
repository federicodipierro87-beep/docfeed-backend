// Schemi di validazione con Zod per DocuVault

import { z } from 'zod';
import { UserRole, LicensePlan, MetadataFieldType, DocumentStatus, PermissionType, RetentionAction } from '@prisma/client';

// === AUTENTICAZIONE ===

export const loginSchema = z.object({
  email: z.string().email('Email non valida'),
  password: z.string().min(8, 'La password deve avere almeno 8 caratteri'),
});

export const registerSchema = z.object({
  email: z.string().email('Email non valida'),
  password: z
    .string()
    .min(8, 'La password deve avere almeno 8 caratteri')
    .regex(/[A-Z]/, 'La password deve contenere almeno una lettera maiuscola')
    .regex(/[a-z]/, 'La password deve contenere almeno una lettera minuscola')
    .regex(/[0-9]/, 'La password deve contenere almeno un numero'),
  firstName: z.string().min(1, 'Nome richiesto').max(100),
  lastName: z.string().min(1, 'Cognome richiesto').max(100),
  role: z.nativeEnum(UserRole).optional().default('USER'),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token richiesto'),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email('Email non valida'),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Token richiesto'),
  password: z
    .string()
    .min(8, 'La password deve avere almeno 8 caratteri')
    .regex(/[A-Z]/, 'La password deve contenere almeno una lettera maiuscola')
    .regex(/[a-z]/, 'La password deve contenere almeno una lettera minuscola')
    .regex(/[0-9]/, 'La password deve contenere almeno un numero'),
});

// === UTENTI ===

export const updateUserSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  role: z.nativeEnum(UserRole).optional(),
  isActive: z.boolean().optional(),
});

// === VAULT ===

export const createVaultSchema = z.object({
  name: z.string().min(1, 'Nome richiesto').max(100),
  description: z.string().max(500).optional(),
  icon: z.string().max(50).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Colore non valido').optional(),
  metadataClassId: z.string().uuid().optional(),
});

export const updateVaultSchema = createVaultSchema.partial();

// === DOCUMENTI ===

export const createDocumentSchema = z.object({
  name: z.string().min(1, 'Nome richiesto').max(255),
  description: z.string().max(1000).optional(),
  vaultId: z.string().uuid('Vault ID non valido'),
  workflowId: z.string().uuid().optional(),
  retentionPolicyId: z.string().uuid().optional(),
  tags: z.array(z.string().uuid()).optional(),
  metadata: z.array(z.object({
    fieldId: z.string().uuid(),
    value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
  })).optional(),
});

export const updateDocumentSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).optional(),
  vaultId: z.string().uuid().optional(),
  workflowId: z.string().uuid().nullable().optional(),
  retentionPolicyId: z.string().uuid().nullable().optional(),
  tags: z.array(z.string().uuid()).optional(),
  metadata: z.array(z.object({
    fieldId: z.string().uuid(),
    value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()]),
  })).optional(),
});

export const documentFiltersSchema = z.object({
  vaultId: z.string().uuid().optional(),
  status: z.nativeEnum(DocumentStatus).optional(),
  mimeType: z.string().optional(),
  tags: z.array(z.string().uuid()).optional(),
  workflowStateId: z.string().uuid().optional(),
  createdById: z.string().uuid().optional(),
  createdAfter: z.coerce.date().optional(),
  createdBefore: z.coerce.date().optional(),
  search: z.string().max(200).optional(),
});

// === METADATA ===

export const createMetadataClassSchema = z.object({
  name: z.string().min(1, 'Nome richiesto').max(100),
  description: z.string().max(500).optional(),
});

export const createMetadataFieldSchema = z.object({
  name: z.string().min(1).max(50).regex(/^[a-z_][a-z0-9_]*$/, 'Nome deve essere snake_case'),
  label: z.string().min(1, 'Label richiesta').max(100),
  type: z.nativeEnum(MetadataFieldType),
  isRequired: z.boolean().optional().default(false),
  isSearchable: z.boolean().optional().default(true),
  defaultValue: z.string().optional(),
  options: z.array(z.string()).optional(), // Per SELECT/MULTISELECT
  order: z.number().int().min(0).optional(),
});

export const updateMetadataFieldSchema = createMetadataFieldSchema.partial();

// === WORKFLOW ===

export const createWorkflowSchema = z.object({
  name: z.string().min(1, 'Nome richiesto').max(100),
  description: z.string().max(500).optional(),
});

export const createWorkflowStateSchema = z.object({
  name: z.string().min(1, 'Nome richiesto').max(50),
  description: z.string().max(200).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().default('#6366f1'),
  isInitial: z.boolean().optional().default(false),
  isFinal: z.boolean().optional().default(false),
  order: z.number().int().min(0).optional(),
  assigneeIds: z.array(z.string().uuid()).optional(),
});

export const createWorkflowTransitionSchema = z.object({
  name: z.string().min(1, 'Nome richiesto').max(50),
  fromStateId: z.string().uuid('Stato di partenza non valido'),
  toStateId: z.string().uuid('Stato di arrivo non valido'),
  requiredRole: z.nativeEnum(UserRole).optional(),
  notifyUsers: z.boolean().optional().default(true),
});

export const workflowTransitionRequestSchema = z.object({
  toStateId: z.string().uuid('Stato non valido'),
  comment: z.string().max(500).optional(),
});

// === TAG ===

export const createTagSchema = z.object({
  name: z.string().min(1, 'Nome richiesto').max(50),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().default('#6366f1'),
});

// === PERMESSI ===

export const createPermissionSchema = z.object({
  userId: z.string().uuid('Utente non valido'),
  permission: z.nativeEnum(PermissionType),
  expiresAt: z.coerce.date().optional(),
});

// === RETENTION POLICIES ===

export const createRetentionPolicySchema = z.object({
  name: z.string().min(1, 'Nome richiesto').max(100),
  description: z.string().max(500).optional(),
  retentionDays: z.number().int().min(1, 'Deve essere almeno 1 giorno'),
  action: z.nativeEnum(RetentionAction),
  conditions: z.object({}).passthrough().optional(),
});

// === LICENZE ===

export const activateLicenseSchema = z.object({
  licenseKey: z.string().min(1, 'Chiave licenza richiesta'),
});

// === PAGINAZIONE ===

export const paginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
});

// === RICERCA ===

export const searchQuerySchema = z.object({
  q: z.string().min(1, 'Query richiesta').max(200),
  vaultId: z.string().uuid().optional(),
  mimeTypes: z.array(z.string()).optional(),
  tags: z.array(z.string().uuid()).optional(),
  workflowStateId: z.string().uuid().optional(),
  createdAfter: z.coerce.date().optional(),
  createdBefore: z.coerce.date().optional(),
  metadataFilters: z.array(z.object({
    fieldId: z.string().uuid(),
    operator: z.enum(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'in']),
    value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
  })).optional(),
});

// === AUDIT LOG ===

export const auditLogFiltersSchema = z.object({
  userId: z.string().uuid().optional(),
  documentId: z.string().uuid().optional(),
  action: z.string().optional(),
  entityType: z.string().optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
});

// === TIPI INFERITI ===

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type CreateVaultInput = z.infer<typeof createVaultSchema>;
export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;
export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>;
export type CreateMetadataClassInput = z.infer<typeof createMetadataClassSchema>;
export type CreateMetadataFieldInput = z.infer<typeof createMetadataFieldSchema>;
export type CreateWorkflowInput = z.infer<typeof createWorkflowSchema>;
export type CreateWorkflowStateInput = z.infer<typeof createWorkflowStateSchema>;
export type CreateTagInput = z.infer<typeof createTagSchema>;
export type SearchQueryInput = z.infer<typeof searchQuerySchema>;
