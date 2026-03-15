// Controller Autenticazione per DocuVault

import { Request, Response } from 'express';
import {
  login,
  registerUser,
  refreshAccessToken,
  logout,
  requestPasswordReset,
  resetPassword,
  changePassword,
} from '../services/auth.service.js';
import { createAuditLog } from '../services/audit.service.js';
import { asyncHandler } from '../middleware/error.middleware.js';

/**
 * POST /api/auth/login
 * Login utente
 */
export const loginController = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body;

  const { user, tokens } = await login(email, password);

  // Audit log
  await createAuditLog(
    {
      action: 'LOGIN',
      entityType: 'User',
      entityId: user.id,
    },
    {
      userId: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
    },
    {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    }
  );

  res.json({
    success: true,
    data: {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        organizationId: user.organizationId,
      },
      tokens,
    },
  });
});

/**
 * POST /api/auth/register
 * Registrazione nuovo utente (solo admin)
 */
export const registerController = asyncHandler(async (req: Request, res: Response) => {
  const { email, password, firstName, lastName, role } = req.body;

  const user = await registerUser(
    { email, password, firstName, lastName, role },
    req.user!.organizationId,
    req.user!.userId
  );

  res.status(201).json({
    success: true,
    data: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
    },
  });
});

/**
 * POST /api/auth/refresh
 * Rinnovo access token
 */
export const refreshController = asyncHandler(async (req: Request, res: Response) => {
  const { refreshToken } = req.body;

  const tokens = await refreshAccessToken(refreshToken);

  res.json({
    success: true,
    data: { tokens },
  });
});

/**
 * POST /api/auth/logout
 * Logout e revoca tokens
 */
export const logoutController = asyncHandler(async (req: Request, res: Response) => {
  await logout(req.user!.userId, req.user!.jti);

  // Audit log
  await createAuditLog(
    {
      action: 'LOGOUT',
      entityType: 'User',
      entityId: req.user!.userId,
    },
    req.user!,
    {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    }
  );

  res.json({
    success: true,
    message: 'Logout effettuato',
  });
});

/**
 * POST /api/auth/forgot-password
 * Richiesta reset password
 */
export const forgotPasswordController = asyncHandler(async (req: Request, res: Response) => {
  const { email } = req.body;

  await requestPasswordReset(email);

  // Risposta generica per non rivelare se email esiste
  res.json({
    success: true,
    message: 'Se l\'email è registrata, riceverai le istruzioni per il reset',
  });
});

/**
 * POST /api/auth/reset-password
 * Reset password con token
 */
export const resetPasswordController = asyncHandler(async (req: Request, res: Response) => {
  const { token, password } = req.body;

  await resetPassword(token, password);

  res.json({
    success: true,
    message: 'Password reimpostata con successo',
  });
});

/**
 * POST /api/auth/change-password
 * Cambio password (utente autenticato)
 */
export const changePasswordController = asyncHandler(async (req: Request, res: Response) => {
  const { currentPassword, newPassword } = req.body;

  await changePassword(req.user!.userId, currentPassword, newPassword);

  res.json({
    success: true,
    message: 'Password cambiata con successo',
  });
});

/**
 * GET /api/auth/me
 * Profilo utente corrente
 */
export const getMeController = asyncHandler(async (req: Request, res: Response) => {
  // L'utente è già disponibile dal middleware di autenticazione
  // Ma carichiamo dati aggiornati dal DB
  const { prisma } = await import('../services/prisma.service.js');

  const user = await prisma.user.findUnique({
    where: { id: req.user!.userId },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      avatar: true,
      isActive: true,
      lastLoginAt: true,
      organizationId: true,
      organization: {
        select: {
          id: true,
          name: true,
          slug: true,
          logo: true,
        },
      },
      createdAt: true,
    },
  });

  res.json({
    success: true,
    data: user,
  });
});
