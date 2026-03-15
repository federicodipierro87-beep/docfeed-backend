// Servizio Workflow per DocuVault
// Gestione stati, transizioni e notifiche

import { Workflow, WorkflowStateDefinition, WorkflowTransition, UserRole } from '@prisma/client';
import { prisma } from './prisma.service.js';
import { sendWorkflowNotification } from './email.service.js';
import { createAuditLog } from './audit.service.js';
import { logger } from '../utils/logger.js';
import {
  JwtPayload,
  NotFoundError,
  AuthorizationError,
  ValidationError,
  ConflictError,
} from '../types/index.js';

// === CRUD WORKFLOW ===

export async function createWorkflow(
  data: {
    name: string;
    description?: string;
  },
  user: JwtPayload
): Promise<Workflow> {
  // Verifica nome unico per organizzazione
  const existing = await prisma.workflow.findFirst({
    where: {
      organizationId: user.organizationId,
      name: data.name,
    },
  });

  if (existing) {
    throw new ConflictError('Workflow con questo nome già esistente');
  }

  const workflow = await prisma.workflow.create({
    data: {
      name: data.name,
      description: data.description,
      organizationId: user.organizationId,
    },
  });

  logger.info('Workflow creato', { workflowId: workflow.id });

  return workflow;
}

export async function getWorkflow(
  workflowId: string,
  user: JwtPayload
): Promise<Workflow & { states: WorkflowStateDefinition[]; transitions: WorkflowTransition[] }> {
  const workflow = await prisma.workflow.findFirst({
    where: {
      id: workflowId,
      organizationId: user.organizationId,
    },
    include: {
      states: {
        orderBy: { order: 'asc' },
        include: {
          assignees: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
      },
      transitions: {
        include: {
          fromState: { select: { id: true, name: true } },
          toState: { select: { id: true, name: true } },
        },
      },
    },
  });

  if (!workflow) {
    throw new NotFoundError('Workflow');
  }

  return workflow;
}

export async function listWorkflows(user: JwtPayload): Promise<Workflow[]> {
  return prisma.workflow.findMany({
    where: { organizationId: user.organizationId },
    orderBy: { name: 'asc' },
    include: {
      states: { select: { id: true, name: true, color: true, isInitial: true, isFinal: true } },
      _count: { select: { documents: true } },
    },
  });
}

export async function updateWorkflow(
  workflowId: string,
  data: {
    name?: string;
    description?: string;
    isActive?: boolean;
  },
  user: JwtPayload
): Promise<Workflow> {
  const workflow = await prisma.workflow.findFirst({
    where: {
      id: workflowId,
      organizationId: user.organizationId,
    },
  });

  if (!workflow) {
    throw new NotFoundError('Workflow');
  }

  return prisma.workflow.update({
    where: { id: workflowId },
    data,
  });
}

export async function deleteWorkflow(workflowId: string, user: JwtPayload): Promise<void> {
  const workflow = await prisma.workflow.findFirst({
    where: {
      id: workflowId,
      organizationId: user.organizationId,
    },
    include: {
      _count: { select: { documents: true } },
    },
  });

  if (!workflow) {
    throw new NotFoundError('Workflow');
  }

  if (workflow._count.documents > 0) {
    throw new ConflictError('Impossibile eliminare workflow con documenti associati');
  }

  await prisma.workflow.delete({ where: { id: workflowId } });

  logger.info('Workflow eliminato', { workflowId });
}

// === STATI WORKFLOW ===

export async function createWorkflowState(
  workflowId: string,
  data: {
    name: string;
    description?: string;
    color?: string;
    isInitial?: boolean;
    isFinal?: boolean;
    order?: number;
    assigneeIds?: string[];
  },
  user: JwtPayload
): Promise<WorkflowStateDefinition> {
  const workflow = await prisma.workflow.findFirst({
    where: {
      id: workflowId,
      organizationId: user.organizationId,
    },
  });

  if (!workflow) {
    throw new NotFoundError('Workflow');
  }

  // Se è stato iniziale, rimuovi flag da altri stati
  if (data.isInitial) {
    await prisma.workflowStateDefinition.updateMany({
      where: { workflowId, isInitial: true },
      data: { isInitial: false },
    });
  }

  const state = await prisma.workflowStateDefinition.create({
    data: {
      name: data.name,
      description: data.description,
      color: data.color || '#6366f1',
      isInitial: data.isInitial || false,
      isFinal: data.isFinal || false,
      order: data.order || 0,
      workflowId,
      assignees: data.assigneeIds
        ? { connect: data.assigneeIds.map(id => ({ id })) }
        : undefined,
    },
  });

  return state;
}

export async function updateWorkflowState(
  stateId: string,
  data: {
    name?: string;
    description?: string;
    color?: string;
    isInitial?: boolean;
    isFinal?: boolean;
    order?: number;
    assigneeIds?: string[];
  },
  user: JwtPayload
): Promise<WorkflowStateDefinition> {
  const state = await prisma.workflowStateDefinition.findFirst({
    where: {
      id: stateId,
      workflow: { organizationId: user.organizationId },
    },
  });

  if (!state) {
    throw new NotFoundError('Stato workflow');
  }

  // Se è stato iniziale, rimuovi flag da altri stati
  if (data.isInitial) {
    await prisma.workflowStateDefinition.updateMany({
      where: { workflowId: state.workflowId, isInitial: true, id: { not: stateId } },
      data: { isInitial: false },
    });
  }

  return prisma.workflowStateDefinition.update({
    where: { id: stateId },
    data: {
      ...data,
      assignees: data.assigneeIds
        ? { set: data.assigneeIds.map(id => ({ id })) }
        : undefined,
    },
  });
}

export async function deleteWorkflowState(stateId: string, user: JwtPayload): Promise<void> {
  const state = await prisma.workflowStateDefinition.findFirst({
    where: {
      id: stateId,
      workflow: { organizationId: user.organizationId },
    },
    include: {
      _count: { select: { documents: true } },
    },
  });

  if (!state) {
    throw new NotFoundError('Stato workflow');
  }

  if (state._count.documents > 0) {
    throw new ConflictError('Impossibile eliminare stato con documenti associati');
  }

  await prisma.workflowStateDefinition.delete({ where: { id: stateId } });
}

// === TRANSIZIONI ===

export async function createWorkflowTransition(
  workflowId: string,
  data: {
    name: string;
    fromStateId: string;
    toStateId: string;
    requiredRole?: UserRole;
    notifyUsers?: boolean;
  },
  user: JwtPayload
): Promise<WorkflowTransition> {
  const workflow = await prisma.workflow.findFirst({
    where: {
      id: workflowId,
      organizationId: user.organizationId,
    },
  });

  if (!workflow) {
    throw new NotFoundError('Workflow');
  }

  // Verifica che gli stati appartengano al workflow
  const fromState = await prisma.workflowStateDefinition.findFirst({
    where: { id: data.fromStateId, workflowId },
  });

  const toState = await prisma.workflowStateDefinition.findFirst({
    where: { id: data.toStateId, workflowId },
  });

  if (!fromState || !toState) {
    throw new ValidationError('Stati non validi per questo workflow');
  }

  // Verifica transizione non duplicata
  const existingTransition = await prisma.workflowTransition.findFirst({
    where: {
      workflowId,
      fromStateId: data.fromStateId,
      toStateId: data.toStateId,
    },
  });

  if (existingTransition) {
    throw new ConflictError('Transizione già esistente');
  }

  return prisma.workflowTransition.create({
    data: {
      name: data.name,
      fromStateId: data.fromStateId,
      toStateId: data.toStateId,
      workflowId,
      requiredRole: data.requiredRole,
      notifyUsers: data.notifyUsers ?? true,
    },
  });
}

export async function deleteWorkflowTransition(transitionId: string, user: JwtPayload): Promise<void> {
  const transition = await prisma.workflowTransition.findFirst({
    where: {
      id: transitionId,
      workflow: { organizationId: user.organizationId },
    },
  });

  if (!transition) {
    throw new NotFoundError('Transizione workflow');
  }

  await prisma.workflowTransition.delete({ where: { id: transitionId } });
}

// === ESECUZIONE TRANSIZIONI ===

export async function transitionDocument(
  documentId: string,
  toStateId: string,
  comment: string | undefined,
  user: JwtPayload
): Promise<void> {
  // Carica documento con stato corrente
  const document = await prisma.document.findFirst({
    where: {
      id: documentId,
      vault: { organizationId: user.organizationId },
      deletedAt: null,
    },
    include: {
      workflowState: true,
      workflow: {
        include: {
          transitions: {
            include: {
              toState: {
                include: {
                  assignees: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!document) {
    throw new NotFoundError('Documento');
  }

  if (!document.workflow || !document.workflowState) {
    throw new ValidationError('Documento non ha un workflow attivo');
  }

  // Trova transizione valida
  const transition = document.workflow.transitions.find(
    t => t.fromStateId === document.workflowStateId && t.toStateId === toStateId
  );

  if (!transition) {
    throw new ValidationError('Transizione non permessa da questo stato');
  }

  // Verifica ruolo richiesto
  if (transition.requiredRole && !canUserPerformTransition(user.role as UserRole, transition.requiredRole)) {
    throw new AuthorizationError(`Richiesto ruolo ${transition.requiredRole} per questa transizione`);
  }

  const fromStateName = document.workflowState.name;
  const toStateName = transition.toState.name;

  // Esegui transizione
  await prisma.document.update({
    where: { id: documentId },
    data: { workflowStateId: toStateId },
  });

  // Audit log
  await createAuditLog({
    action: 'WORKFLOW_CHANGE',
    entityType: 'Document',
    entityId: documentId,
    documentId,
    details: {
      fromState: { id: document.workflowStateId, name: fromStateName },
      toState: { id: toStateId, name: toStateName },
      comment,
    },
  }, user);

  // Notifiche
  if (transition.notifyUsers) {
    const assignees = transition.toState.assignees;

    // Carica utente che ha eseguito la transizione
    const changedBy = await prisma.user.findUnique({
      where: { id: user.userId },
      select: { firstName: true, lastName: true },
    });

    const changedByName = changedBy
      ? `${changedBy.firstName} ${changedBy.lastName}`
      : 'Sistema';

    // Carica nome documento
    const docName = document.name;

    for (const assignee of assignees) {
      await sendWorkflowNotification(
        assignee.email,
        assignee.firstName,
        docName,
        fromStateName,
        toStateName,
        changedByName
      );
    }

    logger.info('Notifiche workflow inviate', {
      documentId,
      toStateId,
      notifiedUsers: assignees.length,
    });
  }

  logger.info('Transizione workflow eseguita', {
    documentId,
    fromState: fromStateName,
    toState: toStateName,
  });
}

// === DOCUMENTI PER STATO ===

export async function getDocumentsByWorkflowState(
  workflowId: string,
  stateId: string | undefined,
  user: JwtPayload
): Promise<{ stateId: string; stateName: string; documents: { id: string; name: string }[] }[]> {
  const workflow = await prisma.workflow.findFirst({
    where: {
      id: workflowId,
      organizationId: user.organizationId,
    },
    include: {
      states: {
        orderBy: { order: 'asc' },
        include: {
          documents: {
            where: { deletedAt: null },
            select: { id: true, name: true },
          },
        },
      },
    },
  });

  if (!workflow) {
    throw new NotFoundError('Workflow');
  }

  if (stateId) {
    const state = workflow.states.find(s => s.id === stateId);
    if (!state) {
      throw new NotFoundError('Stato workflow');
    }
    return [{
      stateId: state.id,
      stateName: state.name,
      documents: state.documents,
    }];
  }

  return workflow.states.map(state => ({
    stateId: state.id,
    stateName: state.name,
    documents: state.documents,
  }));
}

// === TRANSIZIONI DISPONIBILI ===

export async function getAvailableTransitions(
  documentId: string,
  user: JwtPayload
): Promise<{ id: string; name: string; toState: { id: string; name: string; color: string } }[]> {
  const document = await prisma.document.findFirst({
    where: {
      id: documentId,
      vault: { organizationId: user.organizationId },
      deletedAt: null,
    },
    include: {
      workflow: {
        include: {
          transitions: {
            where: { fromStateId: undefined }, // Verrà filtrato dopo
            include: {
              toState: { select: { id: true, name: true, color: true } },
            },
          },
        },
      },
    },
  });

  if (!document || !document.workflow || !document.workflowStateId) {
    return [];
  }

  // Filtra transizioni disponibili dallo stato corrente
  const transitions = await prisma.workflowTransition.findMany({
    where: {
      workflowId: document.workflow.id,
      fromStateId: document.workflowStateId,
    },
    include: {
      toState: { select: { id: true, name: true, color: true } },
    },
  });

  // Filtra per ruolo utente
  return transitions
    .filter(t => !t.requiredRole || canUserPerformTransition(user.role as UserRole, t.requiredRole))
    .map(t => ({
      id: t.id,
      name: t.name,
      toState: t.toState,
    }));
}

// === HELPER ===

function canUserPerformTransition(userRole: UserRole, requiredRole: UserRole): boolean {
  const roleHierarchy: Record<UserRole, number> = {
    READONLY: 0,
    USER: 1,
    MANAGER: 2,
    ADMIN: 3,
  };

  return roleHierarchy[userRole] >= roleHierarchy[requiredRole];
}
