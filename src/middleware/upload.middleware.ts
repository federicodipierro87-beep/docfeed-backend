// Middleware Upload per DocuVault
// Gestione upload file con multer e validazione

import multer from 'multer';
import { Request, Response, NextFunction } from 'express';
import { ValidationError } from '../types/index.js';

// Configurazione storage in memoria
const storage = multer.memoryStorage();

// Tipi MIME consentiti
const ALLOWED_MIME_TYPES = [
  // Documenti
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
  'text/plain',
  'text/csv',
  'text/html',
  'text/xml',
  'application/xml',
  'application/json',

  // Immagini
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/tiff',
  'image/bmp',
  'image/svg+xml',

  // Archivi
  'application/zip',
  'application/x-rar-compressed',
  'application/x-7z-compressed',
  'application/gzip',
  'application/x-tar',

  // Altri
  'application/rtf',
  'application/epub+zip',
];

// Tipi MIME pericolosi (bloccati)
const BLOCKED_MIME_TYPES = [
  'application/x-msdownload',
  'application/x-executable',
  'application/x-dosexec',
  'application/x-sh',
  'application/x-shellscript',
  'text/x-script.python',
  'application/x-httpd-php',
];

// Estensioni pericolose
const BLOCKED_EXTENSIONS = [
  '.exe', '.bat', '.cmd', '.com', '.msi', '.scr', '.pif',
  '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh',
  '.ps1', '.psm1', '.psd1',
  '.sh', '.bash', '.zsh',
  '.php', '.php3', '.php4', '.php5', '.phtml',
  '.py', '.pyc', '.pyo',
  '.rb', '.pl', '.cgi',
  '.dll', '.so', '.dylib',
];

// Limite dimensione file (default 100MB)
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE_MB || '100') * 1024 * 1024;

// Filtro file
const fileFilter = (
  req: Request,
  file: Express.Multer.File,
  callback: multer.FileFilterCallback
) => {
  // Controlla estensione
  const extension = '.' + file.originalname.split('.').pop()?.toLowerCase();
  if (BLOCKED_EXTENSIONS.includes(extension)) {
    callback(new ValidationError(`Estensione file non consentita: ${extension}`));
    return;
  }

  // Controlla MIME type bloccati
  if (BLOCKED_MIME_TYPES.includes(file.mimetype)) {
    callback(new ValidationError(`Tipo file non consentito: ${file.mimetype}`));
    return;
  }

  // Se lista whitelist è attiva, controlla
  if (process.env.STRICT_MIME_CHECK === 'true') {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      callback(new ValidationError(`Tipo file non consentito: ${file.mimetype}`));
      return;
    }
  }

  callback(null, true);
};

// Configurazione multer
const uploadConfig = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 10, // Max 10 file per richiesta
  },
});

// === MIDDLEWARE EXPORTS ===

/**
 * Upload singolo file
 */
export const uploadSingle = (fieldName: string = 'file') => {
  return uploadConfig.single(fieldName);
};

/**
 * Upload multipli file
 */
export const uploadMultiple = (fieldName: string = 'files', maxCount: number = 10) => {
  return uploadConfig.array(fieldName, maxCount);
};

/**
 * Upload con campi multipli
 */
export const uploadFields = (fields: multer.Field[]) => {
  return uploadConfig.fields(fields);
};

/**
 * Middleware per verificare che il file sia presente
 */
export function requireFile(req: Request, res: Response, next: NextFunction): void {
  if (!req.file) {
    res.status(400).json({
      success: false,
      error: 'File richiesto',
      code: 'FILE_REQUIRED',
    });
    return;
  }
  next();
}

/**
 * Middleware per verificare che almeno un file sia presente
 */
export function requireFiles(req: Request, res: Response, next: NextFunction): void {
  if (!req.files || (Array.isArray(req.files) && req.files.length === 0)) {
    res.status(400).json({
      success: false,
      error: 'Almeno un file richiesto',
      code: 'FILES_REQUIRED',
    });
    return;
  }
  next();
}

/**
 * Middleware per limitare tipi MIME specifici
 */
export function allowMimeTypes(...mimeTypes: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.file && !mimeTypes.includes(req.file.mimetype)) {
      res.status(400).json({
        success: false,
        error: `Tipo file non consentito. Tipi ammessi: ${mimeTypes.join(', ')}`,
        code: 'INVALID_MIME_TYPE',
      });
      return;
    }

    if (req.files && Array.isArray(req.files)) {
      const invalidFile = req.files.find(f => !mimeTypes.includes(f.mimetype));
      if (invalidFile) {
        res.status(400).json({
          success: false,
          error: `Tipo file non consentito: ${invalidFile.mimetype}. Tipi ammessi: ${mimeTypes.join(', ')}`,
          code: 'INVALID_MIME_TYPE',
        });
        return;
      }
    }

    next();
  };
}

/**
 * Middleware per limitare dimensione file
 */
export function maxFileSize(maxSizeMB: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const maxSizeBytes = maxSizeMB * 1024 * 1024;

    if (req.file && req.file.size > maxSizeBytes) {
      res.status(400).json({
        success: false,
        error: `File troppo grande. Dimensione massima: ${maxSizeMB}MB`,
        code: 'FILE_TOO_LARGE',
      });
      return;
    }

    if (req.files && Array.isArray(req.files)) {
      const totalSize = req.files.reduce((sum, f) => sum + f.size, 0);
      if (totalSize > maxSizeBytes) {
        res.status(400).json({
          success: false,
          error: `Dimensione totale file troppo grande. Massimo: ${maxSizeMB}MB`,
          code: 'FILES_TOO_LARGE',
        });
        return;
      }
    }

    next();
  };
}

/**
 * Handler errori multer
 */
export function handleUploadError(
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (error instanceof multer.MulterError) {
    switch (error.code) {
      case 'LIMIT_FILE_SIZE':
        res.status(400).json({
          success: false,
          error: `File troppo grande. Dimensione massima: ${MAX_FILE_SIZE / (1024 * 1024)}MB`,
          code: 'FILE_TOO_LARGE',
        });
        return;

      case 'LIMIT_FILE_COUNT':
        res.status(400).json({
          success: false,
          error: 'Troppi file. Massimo 10 file per richiesta',
          code: 'TOO_MANY_FILES',
        });
        return;

      case 'LIMIT_UNEXPECTED_FILE':
        res.status(400).json({
          success: false,
          error: 'Campo file non previsto',
          code: 'UNEXPECTED_FILE_FIELD',
        });
        return;

      default:
        res.status(400).json({
          success: false,
          error: 'Errore upload file',
          code: `MULTER_${error.code}`,
        });
        return;
    }
  }

  next(error);
}

// Export configurazione per use case specifici
export { ALLOWED_MIME_TYPES, BLOCKED_MIME_TYPES, BLOCKED_EXTENSIONS, MAX_FILE_SIZE };
