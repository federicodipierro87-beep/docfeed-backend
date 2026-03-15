// Servizio Licenze per DocuVault
// Gestione attivazione, validazione e controllo limiti

import { LicensePlan, License } from '@prisma/client';
import { prisma } from './prisma.service.js';
import { cacheLicenseInfo, getCachedLicenseInfo, invalidateLicenseCache } from './redis.service.js';
import { generateLicenseKey, decodeLicenseKey, LicenseData, generateUUID } from '../utils/crypto.js';
import { logger } from '../utils/logger.js';
import { LicenseInfo, LicenseFeature, PLAN_FEATURES, PLAN_LIMITS, LicenseError, NotFoundError } from '../types/index.js';

// === GENERAZIONE LICENZE ===

export async function createLicense(
  organizationId: string,
  plan: LicensePlan,
  validDays: number = 365
): Promise<License> {
  const now = new Date();
  const validFrom = now;
  const validUntil = new Date(now.getTime() + validDays * 24 * 60 * 60 * 1000);

  const limits = PLAN_LIMITS[plan];
  const features = PLAN_FEATURES[plan];

  // Genera chiave licenza crittografata
  const licenseData: LicenseData = {
    organizationId,
    plan,
    maxUsers: limits.maxUsers,
    maxStorageGB: limits.maxStorageGB,
    features,
    validFrom: validFrom.toISOString(),
    validUntil: validUntil.toISOString(),
    issuedAt: now.toISOString(),
    signature: generateUUID(),
  };

  const licenseKey = generateLicenseKey(licenseData);

  // Crea record licenza
  const license = await prisma.license.create({
    data: {
      licenseKey,
      plan,
      maxUsers: limits.maxUsers,
      maxStorageGB: limits.maxStorageGB,
      features: features as unknown as string[],
      validFrom,
      validUntil,
      isActive: true,
      organizationId,
    },
  });

  logger.info('Licenza creata', { licenseId: license.id, organizationId, plan });

  return license;
}

// === ATTIVAZIONE LICENZA ===

export async function activateLicense(licenseKey: string, organizationId: string): Promise<License> {
  // Decodifica e valida chiave
  const licenseData = decodeLicenseKey(licenseKey);

  if (!licenseData) {
    throw new LicenseError('Chiave licenza non valida');
  }

  // Verifica data scadenza
  if (new Date(licenseData.validUntil) < new Date()) {
    throw new LicenseError('Licenza scaduta');
  }

  // Verifica che non sia già attiva per un'altra organizzazione
  const existingLicense = await prisma.license.findUnique({
    where: { licenseKey },
  });

  if (existingLicense && existingLicense.organizationId !== organizationId) {
    throw new LicenseError('Licenza già attivata per un\'altra organizzazione');
  }

  // Disattiva licenza precedente dell'organizzazione
  await prisma.license.updateMany({
    where: { organizationId, isActive: true },
    data: { isActive: false },
  });

  // Crea o aggiorna licenza
  const license = await prisma.license.upsert({
    where: { licenseKey },
    create: {
      licenseKey,
      plan: licenseData.plan as LicensePlan,
      maxUsers: licenseData.maxUsers,
      maxStorageGB: licenseData.maxStorageGB,
      features: licenseData.features,
      validFrom: new Date(licenseData.validFrom),
      validUntil: new Date(licenseData.validUntil),
      isActive: true,
      organizationId,
    },
    update: {
      isActive: true,
      organizationId,
    },
  });

  // Invalida cache
  await invalidateLicenseCache(organizationId);

  logger.info('Licenza attivata', { licenseId: license.id, organizationId });

  return license;
}

// === VALIDAZIONE LICENZA ===

export async function getLicenseInfo(organizationId: string): Promise<LicenseInfo> {
  // Controlla cache
  const cached = await getCachedLicenseInfo<LicenseInfo>(organizationId);
  if (cached) {
    return cached;
  }

  // Carica da DB
  const license = await prisma.license.findFirst({
    where: { organizationId, isActive: true },
    include: {
      organization: {
        include: {
          users: { where: { isActive: true }, select: { id: true } },
        },
      },
    },
  });

  if (!license) {
    throw new LicenseError('Nessuna licenza attiva per questa organizzazione');
  }

  const now = new Date();
  const isValid = license.isActive && license.validUntil > now;

  const licenseInfo: LicenseInfo = {
    plan: license.plan,
    maxUsers: license.maxUsers,
    maxStorageGB: license.maxStorageGB,
    features: license.features as LicenseFeature[],
    validUntil: license.validUntil,
    isValid,
    currentUsers: license.organization.users.length,
    currentStorageGB: license.organization.storageUsedMB / 1024,
  };

  // Salva in cache
  await cacheLicenseInfo(organizationId, licenseInfo);

  return licenseInfo;
}

export async function validateLicense(organizationId: string): Promise<boolean> {
  try {
    const licenseInfo = await getLicenseInfo(organizationId);
    return licenseInfo.isValid;
  } catch {
    return false;
  }
}

// === CONTROLLO LIMITI ===

export async function checkUserLimit(organizationId: string): Promise<boolean> {
  const licenseInfo = await getLicenseInfo(organizationId);

  // -1 significa illimitato
  if (licenseInfo.maxUsers === -1) {
    return true;
  }

  return licenseInfo.currentUsers < licenseInfo.maxUsers;
}

export async function checkStorageLimit(organizationId: string, additionalMB: number = 0): Promise<boolean> {
  const licenseInfo = await getLicenseInfo(organizationId);

  // -1 significa illimitato
  if (licenseInfo.maxStorageGB === -1) {
    return true;
  }

  const maxStorageMB = licenseInfo.maxStorageGB * 1024;
  const currentStorageMB = licenseInfo.currentStorageGB * 1024;

  return (currentStorageMB + additionalMB) <= maxStorageMB;
}

export async function hasFeature(organizationId: string, feature: LicenseFeature): Promise<boolean> {
  const licenseInfo = await getLicenseInfo(organizationId);
  return licenseInfo.features.includes(feature);
}

// === AGGIORNAMENTO STORAGE ===

export async function updateStorageUsage(organizationId: string, deltaMB: number): Promise<void> {
  await prisma.organization.update({
    where: { id: organizationId },
    data: {
      storageUsedMB: {
        increment: deltaMB,
      },
    },
  });

  // Invalida cache licenza
  await invalidateLicenseCache(organizationId);
}

// === STATISTICHE LICENZA ===

export async function getLicenseStats(organizationId: string): Promise<{
  license: LicenseInfo;
  usagePercent: {
    users: number;
    storage: number;
  };
  daysRemaining: number;
}> {
  const licenseInfo = await getLicenseInfo(organizationId);

  const usersPercent = licenseInfo.maxUsers === -1
    ? 0
    : (licenseInfo.currentUsers / licenseInfo.maxUsers) * 100;

  const storagePercent = licenseInfo.maxStorageGB === -1
    ? 0
    : (licenseInfo.currentStorageGB / licenseInfo.maxStorageGB) * 100;

  const now = new Date();
  const daysRemaining = Math.max(0, Math.ceil(
    (licenseInfo.validUntil.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)
  ));

  return {
    license: licenseInfo,
    usagePercent: {
      users: Math.round(usersPercent * 100) / 100,
      storage: Math.round(storagePercent * 100) / 100,
    },
    daysRemaining,
  };
}

// === RINNOVO LICENZA ===

export async function renewLicense(
  organizationId: string,
  additionalDays: number
): Promise<License> {
  const license = await prisma.license.findFirst({
    where: { organizationId, isActive: true },
  });

  if (!license) {
    throw new NotFoundError('Licenza');
  }

  const newValidUntil = new Date(
    Math.max(license.validUntil.getTime(), Date.now()) + additionalDays * 24 * 60 * 60 * 1000
  );

  const updatedLicense = await prisma.license.update({
    where: { id: license.id },
    data: { validUntil: newValidUntil },
  });

  await invalidateLicenseCache(organizationId);

  logger.info('Licenza rinnovata', { licenseId: license.id, newValidUntil });

  return updatedLicense;
}

// === UPGRADE LICENZA ===

export async function upgradeLicense(
  organizationId: string,
  newPlan: LicensePlan
): Promise<License> {
  const license = await prisma.license.findFirst({
    where: { organizationId, isActive: true },
  });

  if (!license) {
    throw new NotFoundError('Licenza');
  }

  const limits = PLAN_LIMITS[newPlan];
  const features = PLAN_FEATURES[newPlan];

  const updatedLicense = await prisma.license.update({
    where: { id: license.id },
    data: {
      plan: newPlan,
      maxUsers: limits.maxUsers,
      maxStorageGB: limits.maxStorageGB,
      features: features as unknown as string[],
    },
  });

  await invalidateLicenseCache(organizationId);

  logger.info('Licenza aggiornata', { licenseId: license.id, oldPlan: license.plan, newPlan });

  return updatedLicense;
}
