// Servizio Autenticazione per DocuVault
// Gestione JWT, login, registrazione, password reset

import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { User, UserRole } from '@prisma/client';
import { prisma } from './prisma.service.js';
import {
  storeRefreshToken,
  isRefreshTokenValid,
  revokeRefreshToken,
  revokeAllUserTokens,
  blacklistAccessToken,
} from './redis.service.js';
import { generateSecureToken, generateUUID } from '../utils/crypto.js';
import { sendPasswordResetEmail } from './email.service.js';
import { logger } from '../utils/logger.js';
import {
  JwtPayload,
  TokenPair,
  AuthenticationError,
  NotFoundError,
  ConflictError,
  ValidationError,
} from '../types/index.js';

const BCRYPT_ROUNDS = 12;
const ACCESS_TOKEN_EXPIRY = process.env.JWT_EXPIRES_IN || '15m';
const REFRESH_TOKEN_EXPIRY = process.env.JWT_REFRESH_EXPIRES_IN || '7d';
const PASSWORD_RESET_EXPIRY_HOURS = 24;

// === REGISTRAZIONE ===

export async function registerUser(
  data: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    role?: UserRole;
  },
  organizationId: string,
  createdBy?: string
): Promise<User> {
  // Verifica email unica
  const existingUser = await prisma.user.findUnique({
    where: { email: data.email.toLowerCase() },
  });

  if (existingUser) {
    throw new ConflictError('Email già registrata');
  }

  // Hash password
  const passwordHash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);

  // Crea utente
  const user = await prisma.user.create({
    data: {
      email: data.email.toLowerCase(),
      passwordHash,
      firstName: data.firstName,
      lastName: data.lastName,
      role: data.role || UserRole.USER,
      organizationId,
    },
  });

  logger.info('Nuovo utente registrato', { userId: user.id, email: user.email });

  return user;
}

// === LOGIN ===

export async function login(email: string, password: string): Promise<{ user: User; tokens: TokenPair }> {
  // Trova utente
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    include: { organization: true },
  });

  if (!user) {
    throw new AuthenticationError('Credenziali non valide');
  }

  if (!user.isActive) {
    throw new AuthenticationError('Account disabilitato');
  }

  // Verifica password
  const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
  if (!isPasswordValid) {
    throw new AuthenticationError('Credenziali non valide');
  }

  // Aggiorna ultimo login
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  // Genera tokens
  const tokens = await generateTokenPair(user);

  logger.info('Login effettuato', { userId: user.id });

  return { user, tokens };
}

// === TOKEN MANAGEMENT ===

export async function generateTokenPair(user: User): Promise<TokenPair> {
  const tokenId = generateUUID();

  const payload: JwtPayload = {
    userId: user.id,
    email: user.email,
    role: user.role,
    organizationId: user.organizationId,
  };

  // Access token
  const accessToken = jwt.sign(
    { ...payload, jti: tokenId },
    process.env.JWT_SECRET!,
    { expiresIn: ACCESS_TOKEN_EXPIRY }
  );

  // Refresh token
  const refreshTokenId = generateUUID();
  const refreshToken = jwt.sign(
    { userId: user.id, jti: refreshTokenId, type: 'refresh' },
    process.env.JWT_REFRESH_SECRET!,
    { expiresIn: REFRESH_TOKEN_EXPIRY }
  );

  // Salva refresh token in Redis
  const refreshExpirySeconds = parseExpiry(REFRESH_TOKEN_EXPIRY);
  await storeRefreshToken(user.id, refreshTokenId, refreshExpirySeconds);

  // Salva anche nel DB per tracking
  await prisma.refreshToken.create({
    data: {
      token: refreshTokenId,
      userId: user.id,
      expiresAt: new Date(Date.now() + refreshExpirySeconds * 1000),
    },
  });

  return { accessToken, refreshToken };
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenPair> {
  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET!) as {
      userId: string;
      jti: string;
      type: string;
    };

    if (decoded.type !== 'refresh') {
      throw new AuthenticationError('Token non valido');
    }

    // Verifica token in Redis
    const isValid = await isRefreshTokenValid(decoded.userId, decoded.jti);
    if (!isValid) {
      throw new AuthenticationError('Token revocato o scaduto');
    }

    // Trova utente
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
    });

    if (!user || !user.isActive) {
      throw new AuthenticationError('Utente non trovato o disabilitato');
    }

    // Revoca vecchio refresh token
    await revokeRefreshToken(decoded.userId, decoded.jti);
    await prisma.refreshToken.updateMany({
      where: { token: decoded.jti },
      data: { revokedAt: new Date() },
    });

    // Genera nuovi token
    return generateTokenPair(user);
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new AuthenticationError('Refresh token scaduto');
    }
    if (error instanceof jwt.JsonWebTokenError) {
      throw new AuthenticationError('Token non valido');
    }
    throw error;
  }
}

export async function logout(userId: string, accessTokenJti?: string): Promise<void> {
  // Revoca tutti i refresh tokens
  await revokeAllUserTokens(userId);

  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  // Blacklist access token corrente se fornito
  if (accessTokenJti) {
    const accessExpirySeconds = parseExpiry(ACCESS_TOKEN_EXPIRY);
    await blacklistAccessToken(accessTokenJti, accessExpirySeconds);
  }

  logger.info('Logout effettuato', { userId });
}

export function verifyAccessToken(token: string): JwtPayload & { jti: string } {
  try {
    return jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload & { jti: string };
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new AuthenticationError('Token scaduto');
    }
    throw new AuthenticationError('Token non valido');
  }
}

// === PASSWORD RESET ===

export async function requestPasswordReset(email: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
  });

  // Non rivelare se l'email esiste
  if (!user) {
    logger.warn('Richiesta reset password per email non esistente', { email });
    return;
  }

  // Genera token
  const token = generateSecureToken();
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_EXPIRY_HOURS * 60 * 60 * 1000);

  // Invalida token precedenti
  await prisma.passwordReset.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date() },
  });

  // Crea nuovo token
  await prisma.passwordReset.create({
    data: {
      token,
      userId: user.id,
      expiresAt,
    },
  });

  // Invia email
  await sendPasswordResetEmail(user.email, user.firstName, token);

  logger.info('Email reset password inviata', { userId: user.id });
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const resetRecord = await prisma.passwordReset.findUnique({
    where: { token },
    include: { user: true },
  });

  if (!resetRecord) {
    throw new ValidationError('Token non valido');
  }

  if (resetRecord.usedAt) {
    throw new ValidationError('Token già utilizzato');
  }

  if (resetRecord.expiresAt < new Date()) {
    throw new ValidationError('Token scaduto');
  }

  // Hash nuova password
  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

  // Aggiorna password e marca token come usato
  await prisma.$transaction([
    prisma.user.update({
      where: { id: resetRecord.userId },
      data: { passwordHash },
    }),
    prisma.passwordReset.update({
      where: { id: resetRecord.id },
      data: { usedAt: new Date() },
    }),
  ]);

  // Revoca tutti i token dell'utente
  await revokeAllUserTokens(resetRecord.userId);

  logger.info('Password reimpostata', { userId: resetRecord.userId });
}

// === CAMBIO PASSWORD ===

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    throw new NotFoundError('Utente');
  }

  // Verifica password corrente
  const isPasswordValid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!isPasswordValid) {
    throw new ValidationError('Password corrente non corretta');
  }

  // Hash nuova password
  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash },
  });

  logger.info('Password cambiata', { userId });
}

// === HELPER ===

function parseExpiry(expiry: string): number {
  const match = expiry.match(/^(\d+)([smhd])$/);
  if (!match) {
    return 900; // Default 15 minuti
  }

  const value = parseInt(match[1]);
  const unit = match[2];

  switch (unit) {
    case 's':
      return value;
    case 'm':
      return value * 60;
    case 'h':
      return value * 60 * 60;
    case 'd':
      return value * 24 * 60 * 60;
    default:
      return 900;
  }
}
