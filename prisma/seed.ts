// Seed Data per DocuVault
// Popola il database con dati di esempio

import { PrismaClient, UserRole, LicensePlan, MetadataFieldType, RetentionAction } from '@prisma/client';
import bcrypt from 'bcrypt';
import { generateLicenseKey, LicenseData, generateUUID } from '../src/utils/crypto.js';

const prisma = new PrismaClient();

async function main() {
  console.log('Inizio seed database...');

  // === ORGANIZZAZIONE ===
  const organization = await prisma.organization.upsert({
    where: { slug: 'demo-corp' },
    update: {},
    create: {
      name: 'Demo Corp',
      slug: 'demo-corp',
      domain: 'demo-corp.local',
      settings: {
        theme: 'light',
        language: 'it',
      },
    },
  });

  console.log('Organizzazione creata:', organization.name);

  // === LICENZA BUSINESS ===
  const now = new Date();
  const validUntil = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000); // 1 anno

  const features = [
    'custom_metadata',
    'ocr',
    'audit_log',
    'workflow',
    'retention',
    'advanced_search',
  ];

  // Genera chiave licenza
  const licenseData: LicenseData = {
    organizationId: organization.id,
    plan: 'BUSINESS',
    maxUsers: 100,
    maxStorageGB: 1000,
    features,
    validFrom: now.toISOString(),
    validUntil: validUntil.toISOString(),
    issuedAt: now.toISOString(),
    signature: generateUUID(),
  };

  const licenseKey = generateLicenseKey(licenseData);

  const license = await prisma.license.upsert({
    where: { organizationId: organization.id },
    update: {},
    create: {
      licenseKey,
      plan: LicensePlan.BUSINESS,
      maxUsers: 100,
      maxStorageGB: 1000,
      features,
      validFrom: now,
      validUntil,
      isActive: true,
      organizationId: organization.id,
    },
  });

  console.log('Licenza creata:', license.plan);

  // === UTENTI ===
  const passwordHash = await bcrypt.hash('Password123!', 12);

  const users = [
    {
      email: 'admin@demo.com',
      firstName: 'Admin',
      lastName: 'Sistema',
      role: UserRole.ADMIN,
    },
    {
      email: 'manager@demo.com',
      firstName: 'Marco',
      lastName: 'Rossi',
      role: UserRole.MANAGER,
    },
    {
      email: 'user1@demo.com',
      firstName: 'Giulia',
      lastName: 'Bianchi',
      role: UserRole.USER,
    },
    {
      email: 'user2@demo.com',
      firstName: 'Luca',
      lastName: 'Verdi',
      role: UserRole.USER,
    },
    {
      email: 'user3@demo.com',
      firstName: 'Sara',
      lastName: 'Neri',
      role: UserRole.USER,
    },
  ];

  const createdUsers: { [key: string]: string } = {};

  for (const userData of users) {
    const user = await prisma.user.upsert({
      where: { email: userData.email },
      update: {},
      create: {
        ...userData,
        passwordHash,
        isActive: true,
        emailVerified: true,
        organizationId: organization.id,
      },
    });
    createdUsers[userData.email] = user.id;
    console.log('Utente creato:', user.email, '- Ruolo:', user.role);
  }

  // === CLASSI METADATA ===

  // Classe Contratti
  const metadataContratti = await prisma.metadataClass.upsert({
    where: {
      organizationId_name: {
        organizationId: organization.id,
        name: 'Contratti',
      },
    },
    update: {},
    create: {
      name: 'Contratti',
      description: 'Metadata per documenti contrattuali',
      organizationId: organization.id,
    },
  });

  const campiContratti = [
    { name: 'cliente', label: 'Cliente', type: MetadataFieldType.TEXT, isRequired: true, order: 0 },
    { name: 'valore', label: 'Valore Contratto (€)', type: MetadataFieldType.NUMBER, isRequired: true, order: 1 },
    { name: 'data_scadenza', label: 'Data Scadenza', type: MetadataFieldType.DATE, isRequired: true, order: 2 },
    {
      name: 'stato_contratto',
      label: 'Stato',
      type: MetadataFieldType.SELECT,
      isRequired: true,
      order: 3,
      options: JSON.stringify(['Attivo', 'In Rinnovo', 'Scaduto', 'Disdetto']),
    },
    { name: 'referente', label: 'Referente', type: MetadataFieldType.USER, order: 4 },
  ];

  for (const campo of campiContratti) {
    await prisma.metadataField.upsert({
      where: {
        metadataClassId_name: {
          metadataClassId: metadataContratti.id,
          name: campo.name,
        },
      },
      update: {},
      create: {
        ...campo,
        metadataClassId: metadataContratti.id,
      },
    });
  }

  console.log('Classe metadata Contratti creata');

  // Classe Fatture
  const metadataFatture = await prisma.metadataClass.upsert({
    where: {
      organizationId_name: {
        organizationId: organization.id,
        name: 'Fatture',
      },
    },
    update: {},
    create: {
      name: 'Fatture',
      description: 'Metadata per fatture',
      organizationId: organization.id,
    },
  });

  const campiFatture = [
    { name: 'fornitore', label: 'Fornitore', type: MetadataFieldType.TEXT, isRequired: true, order: 0 },
    { name: 'importo', label: 'Importo (€)', type: MetadataFieldType.NUMBER, isRequired: true, order: 1 },
    { name: 'data_emissione', label: 'Data Emissione', type: MetadataFieldType.DATE, isRequired: true, order: 2 },
    { name: 'pagato', label: 'Pagato', type: MetadataFieldType.BOOLEAN, order: 3 },
    { name: 'numero_fattura', label: 'Numero Fattura', type: MetadataFieldType.TEXT, isRequired: true, order: 4 },
  ];

  for (const campo of campiFatture) {
    await prisma.metadataField.upsert({
      where: {
        metadataClassId_name: {
          metadataClassId: metadataFatture.id,
          name: campo.name,
        },
      },
      update: {},
      create: {
        ...campo,
        metadataClassId: metadataFatture.id,
      },
    });
  }

  console.log('Classe metadata Fatture creata');

  // === VAULT ===
  const vaultContratti = await prisma.vault.upsert({
    where: {
      organizationId_name: {
        organizationId: organization.id,
        name: 'Contratti',
      },
    },
    update: {},
    create: {
      name: 'Contratti',
      description: 'Archivio contratti aziendali',
      icon: 'file-text',
      color: '#6366f1',
      organizationId: organization.id,
      metadataClassId: metadataContratti.id,
    },
  });

  const vaultFatture = await prisma.vault.upsert({
    where: {
      organizationId_name: {
        organizationId: organization.id,
        name: 'Fatture',
      },
    },
    update: {},
    create: {
      name: 'Fatture',
      description: 'Archivio fatture',
      icon: 'receipt',
      color: '#10b981',
      organizationId: organization.id,
      metadataClassId: metadataFatture.id,
    },
  });

  console.log('Vault creati: Contratti, Fatture');

  // === WORKFLOW ===
  const workflow = await prisma.workflow.upsert({
    where: {
      organizationId_name: {
        organizationId: organization.id,
        name: 'Approvazione Contratto',
      },
    },
    update: {},
    create: {
      name: 'Approvazione Contratto',
      description: 'Processo di approvazione contratti',
      isActive: true,
      organizationId: organization.id,
    },
  });

  // Stati workflow
  const statoBozza = await prisma.workflowStateDefinition.upsert({
    where: {
      workflowId_name: {
        workflowId: workflow.id,
        name: 'Bozza',
      },
    },
    update: {},
    create: {
      name: 'Bozza',
      description: 'Documento in fase di redazione',
      color: '#6b7280',
      isInitial: true,
      order: 0,
      workflowId: workflow.id,
    },
  });

  const statoRevisione = await prisma.workflowStateDefinition.upsert({
    where: {
      workflowId_name: {
        workflowId: workflow.id,
        name: 'In Revisione',
      },
    },
    update: {},
    create: {
      name: 'In Revisione',
      description: 'Documento in attesa di revisione',
      color: '#f59e0b',
      order: 1,
      workflowId: workflow.id,
    },
  });

  const statoApprovato = await prisma.workflowStateDefinition.upsert({
    where: {
      workflowId_name: {
        workflowId: workflow.id,
        name: 'Approvato',
      },
    },
    update: {},
    create: {
      name: 'Approvato',
      description: 'Documento approvato',
      color: '#10b981',
      isFinal: true,
      order: 2,
      workflowId: workflow.id,
    },
  });

  const statoRifiutato = await prisma.workflowStateDefinition.upsert({
    where: {
      workflowId_name: {
        workflowId: workflow.id,
        name: 'Rifiutato',
      },
    },
    update: {},
    create: {
      name: 'Rifiutato',
      description: 'Documento rifiutato',
      color: '#ef4444',
      isFinal: true,
      order: 3,
      workflowId: workflow.id,
    },
  });

  // Transizioni
  await prisma.workflowTransition.upsert({
    where: {
      workflowId_fromStateId_toStateId: {
        workflowId: workflow.id,
        fromStateId: statoBozza.id,
        toStateId: statoRevisione.id,
      },
    },
    update: {},
    create: {
      name: 'Invia per revisione',
      fromStateId: statoBozza.id,
      toStateId: statoRevisione.id,
      workflowId: workflow.id,
      notifyUsers: true,
    },
  });

  await prisma.workflowTransition.upsert({
    where: {
      workflowId_fromStateId_toStateId: {
        workflowId: workflow.id,
        fromStateId: statoRevisione.id,
        toStateId: statoApprovato.id,
      },
    },
    update: {},
    create: {
      name: 'Approva',
      fromStateId: statoRevisione.id,
      toStateId: statoApprovato.id,
      workflowId: workflow.id,
      requiredRole: UserRole.MANAGER,
      notifyUsers: true,
    },
  });

  await prisma.workflowTransition.upsert({
    where: {
      workflowId_fromStateId_toStateId: {
        workflowId: workflow.id,
        fromStateId: statoRevisione.id,
        toStateId: statoRifiutato.id,
      },
    },
    update: {},
    create: {
      name: 'Rifiuta',
      fromStateId: statoRevisione.id,
      toStateId: statoRifiutato.id,
      workflowId: workflow.id,
      requiredRole: UserRole.MANAGER,
      notifyUsers: true,
    },
  });

  await prisma.workflowTransition.upsert({
    where: {
      workflowId_fromStateId_toStateId: {
        workflowId: workflow.id,
        fromStateId: statoRifiutato.id,
        toStateId: statoBozza.id,
      },
    },
    update: {},
    create: {
      name: 'Riporta in bozza',
      fromStateId: statoRifiutato.id,
      toStateId: statoBozza.id,
      workflowId: workflow.id,
      notifyUsers: true,
    },
  });

  console.log('Workflow "Approvazione Contratto" creato con stati e transizioni');

  // === TAG ===
  const tags = [
    { name: 'Urgente', color: '#ef4444' },
    { name: 'Importante', color: '#f59e0b' },
    { name: 'Da Verificare', color: '#3b82f6' },
    { name: 'Archiviato', color: '#6b7280' },
    { name: 'Confidenziale', color: '#8b5cf6' },
  ];

  const createdTags: { [key: string]: string } = {};

  for (const tagData of tags) {
    const tag = await prisma.tag.upsert({
      where: {
        organizationId_name: {
          organizationId: organization.id,
          name: tagData.name,
        },
      },
      update: {},
      create: {
        ...tagData,
        organizationId: organization.id,
      },
    });
    createdTags[tagData.name] = tag.id;
  }

  console.log('Tag creati:', tags.map(t => t.name).join(', '));

  // === RETENTION POLICIES ===
  await prisma.retentionPolicy.upsert({
    where: {
      organizationId_name: {
        organizationId: organization.id,
        name: 'Fatture 10 anni',
      },
    },
    update: {},
    create: {
      name: 'Fatture 10 anni',
      description: 'Conservazione fatture per 10 anni come da normativa',
      retentionDays: 3650,
      action: RetentionAction.ARCHIVE,
      isActive: true,
      organizationId: organization.id,
    },
  });

  await prisma.retentionPolicy.upsert({
    where: {
      organizationId_name: {
        organizationId: organization.id,
        name: 'Contratti scaduti',
      },
    },
    update: {},
    create: {
      name: 'Contratti scaduti',
      description: 'Archiviazione contratti dopo 2 anni dalla scadenza',
      retentionDays: 730,
      action: RetentionAction.ARCHIVE,
      isActive: true,
      organizationId: organization.id,
    },
  });

  console.log('Retention policies create');

  // === RIEPILOGO ===
  console.log('\n========================================');
  console.log('SEED COMPLETATO CON SUCCESSO!');
  console.log('========================================');
  console.log('\nCredenziali di accesso:');
  console.log('----------------------------------------');
  console.log('Admin:   admin@demo.com    / Password123!');
  console.log('Manager: manager@demo.com  / Password123!');
  console.log('User 1:  user1@demo.com    / Password123!');
  console.log('User 2:  user2@demo.com    / Password123!');
  console.log('User 3:  user3@demo.com    / Password123!');
  console.log('----------------------------------------');
  console.log('\nLicenza: BUSINESS (valida 1 anno)');
  console.log('Features: OCR, Workflow, Audit, Retention, Advanced Search');
  console.log('========================================\n');
}

main()
  .catch((e) => {
    console.error('Errore durante seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
