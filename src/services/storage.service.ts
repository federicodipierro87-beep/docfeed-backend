// Servizio Storage per DocuVault
// Abstraction layer per MinIO e AWS S3

import { Client as MinioClient } from 'minio';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { generateChecksum } from '../utils/crypto.js';
import { logger } from '../utils/logger.js';
import { StorageProvider, UploadResult, StorageError } from '../types/index.js';

// === MINIO PROVIDER ===

class MinioStorageProvider implements StorageProvider {
  private client: MinioClient;
  private bucket: string;

  constructor() {
    this.client = new MinioClient({
      endPoint: process.env.MINIO_ENDPOINT || 'localhost',
      port: parseInt(process.env.MINIO_PORT || '9000'),
      useSSL: process.env.MINIO_USE_SSL === 'true',
      accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
      secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
    });

    this.bucket = process.env.MINIO_BUCKET || 'docfeed';
  }

  async initialize(): Promise<void> {
    try {
      const exists = await this.client.bucketExists(this.bucket);
      if (!exists) {
        await this.client.makeBucket(this.bucket);
        logger.info('Bucket MinIO creato', { bucket: this.bucket });
      }
    } catch (error) {
      logger.error('Errore inizializzazione MinIO', { error: (error as Error).message });
      throw new StorageError('Impossibile inizializzare storage MinIO');
    }
  }

  async uploadFile(key: string, buffer: Buffer, mimeType: string): Promise<void> {
    try {
      await this.client.putObject(this.bucket, key, buffer, buffer.length, {
        'Content-Type': mimeType,
      });
    } catch (error) {
      logger.error('Errore upload MinIO', { key, error: (error as Error).message });
      throw new StorageError('Errore durante l\'upload del file');
    }
  }

  async downloadFile(key: string): Promise<Buffer> {
    try {
      const stream = await this.client.getObject(this.bucket, key);
      const chunks: Buffer[] = [];

      return new Promise((resolve, reject) => {
        stream.on('data', (chunk: Buffer) => chunks.push(chunk));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', reject);
      });
    } catch (error) {
      logger.error('Errore download MinIO', { key, error: (error as Error).message });
      throw new StorageError('Errore durante il download del file');
    }
  }

  async deleteFile(key: string): Promise<void> {
    try {
      await this.client.removeObject(this.bucket, key);
    } catch (error) {
      logger.error('Errore eliminazione MinIO', { key, error: (error as Error).message });
      throw new StorageError('Errore durante l\'eliminazione del file');
    }
  }

  async getPresignedUploadUrl(key: string, _mimeType: string, expiresIn: number = 3600): Promise<string> {
    try {
      return await this.client.presignedPutObject(this.bucket, key, expiresIn);
    } catch (error) {
      logger.error('Errore generazione URL upload MinIO', { key, error: (error as Error).message });
      throw new StorageError('Errore generazione URL upload');
    }
  }

  async getPresignedDownloadUrl(key: string, expiresIn: number = 3600): Promise<string> {
    try {
      return await this.client.presignedGetObject(this.bucket, key, expiresIn);
    } catch (error) {
      logger.error('Errore generazione URL download MinIO', { key, error: (error as Error).message });
      throw new StorageError('Errore generazione URL download');
    }
  }

  async fileExists(key: string): Promise<boolean> {
    try {
      await this.client.statObject(this.bucket, key);
      return true;
    } catch {
      return false;
    }
  }
}

// === AWS S3 PROVIDER ===

class S3StorageProvider implements StorageProvider {
  private client: S3Client;
  private bucket: string;

  constructor() {
    const endpoint = process.env.S3_ENDPOINT;
    const region = process.env.S3_REGION || process.env.AWS_REGION || 'auto';
    const accessKeyId = process.env.S3_ACCESS_KEY || process.env.AWS_ACCESS_KEY_ID || '';
    const secretAccessKey = process.env.S3_SECRET_KEY || process.env.AWS_SECRET_ACCESS_KEY || '';

    logger.info('Configurazione S3', {
      endpoint: endpoint || 'default',
      region,
      bucket: process.env.S3_BUCKET || process.env.AWS_S3_BUCKET,
      hasAccessKey: !!accessKeyId,
    });

    this.client = new S3Client({
      region,
      endpoint,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
      forcePathStyle: !!endpoint, // Necessario per R2 e MinIO
    });

    this.bucket = process.env.S3_BUCKET || process.env.AWS_S3_BUCKET || 'docfeed';
  }

  async uploadFile(key: string, buffer: Buffer, mimeType: string): Promise<void> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: buffer,
          ContentType: mimeType,
        })
      );
    } catch (error) {
      logger.error('Errore upload S3', { key, error: (error as Error).message });
      throw new StorageError('Errore durante l\'upload del file');
    }
  }

  async downloadFile(key: string): Promise<Buffer> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        })
      );

      const stream = response.Body as NodeJS.ReadableStream;
      const chunks: Buffer[] = [];

      return new Promise((resolve, reject) => {
        stream.on('data', (chunk: Buffer) => chunks.push(chunk));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', reject);
      });
    } catch (error) {
      logger.error('Errore download S3', { key, error: (error as Error).message });
      throw new StorageError('Errore durante il download del file');
    }
  }

  async deleteFile(key: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: key,
        })
      );
    } catch (error) {
      logger.error('Errore eliminazione S3', { key, error: (error as Error).message });
      throw new StorageError('Errore durante l\'eliminazione del file');
    }
  }

  async getPresignedUploadUrl(key: string, mimeType: string, expiresIn: number = 3600): Promise<string> {
    try {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: mimeType,
      });
      return await getSignedUrl(this.client, command, { expiresIn });
    } catch (error) {
      logger.error('Errore generazione URL upload S3', { key, error: (error as Error).message });
      throw new StorageError('Errore generazione URL upload');
    }
  }

  async getPresignedDownloadUrl(key: string, expiresIn: number = 3600): Promise<string> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      return await getSignedUrl(this.client, command, { expiresIn });
    } catch (error) {
      logger.error('Errore generazione URL download S3', { key, error: (error as Error).message });
      throw new StorageError('Errore generazione URL download');
    }
  }

  async fileExists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        })
      );
      return true;
    } catch {
      return false;
    }
  }
}

// === STORAGE SERVICE SINGLETON ===

let storageProvider: StorageProvider | null = null;

export function getStorageProvider(): StorageProvider {
  if (!storageProvider) {
    const storageType = process.env.STORAGE_TYPE || 'minio';

    if (storageType === 's3') {
      storageProvider = new S3StorageProvider();
      logger.info('Storage provider inizializzato: AWS S3');
    } else {
      storageProvider = new MinioStorageProvider();
      logger.info('Storage provider inizializzato: MinIO');
    }
  }

  return storageProvider;
}

export async function initializeStorage(): Promise<void> {
  const provider = getStorageProvider();

  // MinIO richiede inizializzazione del bucket
  if ('initialize' in provider) {
    await (provider as MinioStorageProvider).initialize();
  }
}

// === HELPER FUNCTIONS ===

/**
 * Genera un path univoco per il file nello storage
 */
export function generateStoragePath(
  organizationId: string,
  vaultId: string,
  documentId: string,
  versionNumber: number,
  originalFilename: string
): string {
  const extension = originalFilename.split('.').pop() || 'bin';
  return `${organizationId}/${vaultId}/${documentId}/v${versionNumber}.${extension}`;
}

/**
 * Carica un file e ritorna i dettagli
 */
export async function uploadFile(
  buffer: Buffer,
  storagePath: string,
  mimeType: string
): Promise<UploadResult> {
  const provider = getStorageProvider();

  const checksum = generateChecksum(buffer);

  await provider.uploadFile(storagePath, buffer, mimeType);

  return {
    key: storagePath,
    size: buffer.length,
    checksum,
  };
}

/**
 * Scarica un file dallo storage
 */
export async function downloadFile(storagePath: string): Promise<Buffer> {
  const provider = getStorageProvider();
  return provider.downloadFile(storagePath);
}

/**
 * Elimina un file dallo storage
 */
export async function deleteFile(storagePath: string): Promise<void> {
  const provider = getStorageProvider();
  await provider.deleteFile(storagePath);
}

/**
 * Genera URL firmato per download
 */
export async function getDownloadUrl(storagePath: string, expiresIn: number = 3600): Promise<string> {
  const provider = getStorageProvider();
  return provider.getPresignedDownloadUrl(storagePath, expiresIn);
}

/**
 * Genera URL firmato per upload diretto
 */
export async function getUploadUrl(
  storagePath: string,
  mimeType: string,
  expiresIn: number = 3600
): Promise<string> {
  const provider = getStorageProvider();
  return provider.getPresignedUploadUrl(storagePath, mimeType, expiresIn);
}

/**
 * Verifica esistenza file
 */
export async function fileExists(storagePath: string): Promise<boolean> {
  const provider = getStorageProvider();
  return provider.fileExists(storagePath);
}
