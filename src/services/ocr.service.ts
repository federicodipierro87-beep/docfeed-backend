// Servizio OCR per DocuVault
// Estrazione testo da documenti con Tesseract.js e Bull queue

import Bull from 'bull';
import Tesseract from 'tesseract.js';
import { prisma } from './prisma.service.js';
import { downloadFile } from './storage.service.js';
import { logger } from '../utils/logger.js';

// Tipi MIME supportati per OCR
const OCR_SUPPORTED_MIMES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/tiff',
  'image/gif',
  'image/bmp',
  'image/webp',
  'application/pdf', // Richiede conversione a immagine
];

// Crea queue per OCR
let ocrQueue: Bull.Queue | null = null;

export function getOCRQueue(): Bull.Queue {
  if (!ocrQueue) {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

    ocrQueue = new Bull('ocr-processing', redisUrl, {
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    });

    // Processor
    ocrQueue.process(async (job) => {
      const { documentId, versionId } = job.data;
      await processOCR(documentId, versionId);
    });

    // Event handlers
    ocrQueue.on('completed', (job) => {
      logger.info('OCR job completato', { jobId: job.id, documentId: job.data.documentId });
    });

    ocrQueue.on('failed', (job, err) => {
      logger.error('OCR job fallito', {
        jobId: job?.id,
        documentId: job?.data?.documentId,
        error: err.message,
      });
    });

    ocrQueue.on('error', (err) => {
      logger.error('Errore queue OCR', { error: err.message });
    });
  }

  return ocrQueue;
}

export async function queueOCRJob(documentId: string, versionId?: string): Promise<void> {
  // Verifica se OCR è abilitato
  if (process.env.OCR_ENABLED !== 'true') {
    return;
  }

  // Carica documento per verificare se supporta OCR
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: { mimeType: true, currentVersionId: true },
  });

  if (!document) {
    logger.warn('Documento non trovato per OCR', { documentId });
    return;
  }

  // Verifica MIME type supportato
  if (!OCR_SUPPORTED_MIMES.includes(document.mimeType)) {
    logger.debug('MIME type non supportato per OCR', { documentId, mimeType: document.mimeType });
    return;
  }

  const targetVersionId = versionId || document.currentVersionId;

  if (!targetVersionId) {
    logger.warn('Nessuna versione disponibile per OCR', { documentId });
    return;
  }

  // Accoda job
  const queue = getOCRQueue();
  await queue.add(
    { documentId, versionId: targetVersionId },
    { priority: 10 }
  );

  logger.info('OCR job accodato', { documentId, versionId: targetVersionId });
}

async function processOCR(documentId: string, versionId: string): Promise<void> {
  logger.info('Inizio processing OCR', { documentId, versionId });

  // Carica versione documento
  const version = await prisma.documentVersion.findUnique({
    where: { id: versionId },
    include: { document: true },
  });

  if (!version) {
    throw new Error(`Versione documento non trovata: ${versionId}`);
  }

  // Scarica file da storage
  const fileBuffer = await downloadFile(version.storagePath);

  // Determina lingua per OCR
  const language = process.env.OCR_LANGUAGE || 'ita+eng';

  // Esegui OCR
  let extractedText = '';

  try {
    if (version.document.mimeType === 'application/pdf') {
      // Per PDF, usiamo pdf-parse o convertiamo pagine in immagini
      extractedText = await processPDFOCR(fileBuffer, language);
    } else {
      // Per immagini, usiamo Tesseract direttamente
      extractedText = await processImageOCR(fileBuffer, language);
    }
  } catch (error) {
    logger.error('Errore durante OCR', {
      documentId,
      versionId,
      error: (error as Error).message,
    });
    throw error;
  }

  // Pulisci testo estratto
  extractedText = cleanOCRText(extractedText);

  // Salva risultato
  await prisma.documentVersion.update({
    where: { id: versionId },
    data: {
      ocrText: extractedText,
      ocrProcessed: true,
      ocrProcessedAt: new Date(),
    },
  });

  logger.info('OCR completato', {
    documentId,
    versionId,
    textLength: extractedText.length,
  });
}

async function processImageOCR(buffer: Buffer, language: string): Promise<string> {
  const worker = await Tesseract.createWorker(language, 1, {
    logger: (m) => {
      if (m.status === 'recognizing text') {
        logger.debug(`OCR progress: ${Math.round(m.progress * 100)}%`);
      }
    },
  });

  try {
    const { data: { text } } = await worker.recognize(buffer);
    return text;
  } finally {
    await worker.terminate();
  }
}

async function processPDFOCR(buffer: Buffer, language: string): Promise<string> {
  // Nota: Per un OCR completo di PDF servirebbero librerie aggiuntive
  // come pdf-poppler o pdf2pic per convertire le pagine in immagini
  // Per ora estraiamo solo il testo embedded se presente

  try {
    // Tentativo di estrarre testo embedded dal PDF
    const textContent = extractTextFromPDFBuffer(buffer);
    if (textContent && textContent.length > 100) {
      return textContent;
    }

    // Se non c'è abbastanza testo embedded, prova OCR sulla prima pagina
    // Questo richiederebbe conversione PDF -> Immagine
    logger.warn('PDF senza testo embedded, OCR limitato');
    return '';
  } catch (error) {
    logger.error('Errore processing PDF OCR', { error: (error as Error).message });
    return '';
  }
}

function extractTextFromPDFBuffer(buffer: Buffer): string {
  // Implementazione semplificata - cerca testo tra i marker PDF
  const content = buffer.toString('latin1');
  const textMatches: string[] = [];

  // Cerca stream di testo
  const streamRegex = /stream\s*([\s\S]*?)\s*endstream/g;
  let match;

  while ((match = streamRegex.exec(content)) !== null) {
    const stream = match[1];
    // Cerca testo tra parentesi (operatore Tj o TJ)
    const textRegex = /\(([^)]+)\)/g;
    let textMatch;

    while ((textMatch = textRegex.exec(stream)) !== null) {
      const text = textMatch[1]
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\\(/g, '(')
        .replace(/\\\)/g, ')');

      if (text.length > 0 && /[a-zA-Z0-9]/.test(text)) {
        textMatches.push(text);
      }
    }
  }

  return textMatches.join(' ');
}

function cleanOCRText(text: string): string {
  return text
    // Rimuovi caratteri di controllo
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // Normalizza spazi
    .replace(/[ \t]+/g, ' ')
    // Normalizza newline
    .replace(/\n{3,}/g, '\n\n')
    // Trim
    .trim();
}

// === STATISTICHE OCR ===

export async function getOCRStats(): Promise<{
  pending: number;
  completed: number;
  failed: number;
  active: number;
}> {
  const queue = getOCRQueue();

  const [pending, completed, failed, active] = await Promise.all([
    queue.getWaitingCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getActiveCount(),
  ]);

  return { pending, completed, failed, active };
}

// === RE-PROCESSING ===

export async function reprocessOCR(documentId: string): Promise<void> {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    include: { currentVersion: true },
  });

  if (!document || !document.currentVersion) {
    throw new Error('Documento o versione non trovati');
  }

  // Reset stato OCR
  await prisma.documentVersion.update({
    where: { id: document.currentVersion.id },
    data: {
      ocrProcessed: false,
      ocrText: null,
      ocrProcessedAt: null,
    },
  });

  // Ri-accoda
  await queueOCRJob(documentId, document.currentVersion.id);
}

// === CLEANUP ===

export async function closeOCRQueue(): Promise<void> {
  if (ocrQueue) {
    await ocrQueue.close();
    ocrQueue = null;
    logger.info('Queue OCR chiusa');
  }
}
