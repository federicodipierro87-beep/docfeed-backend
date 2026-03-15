// Servizio Email per DocuVault
// Invio notifiche e email transazionali

import nodemailer from 'nodemailer';
import { logger } from '../utils/logger.js';

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return transporter;
}

const FROM_ADDRESS = process.env.EMAIL_FROM || 'noreply@docfeed.com';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// === EMAIL TEMPLATES ===

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  try {
    const transport = getTransporter();

    await transport.sendMail({
      from: FROM_ADDRESS,
      to,
      subject,
      html,
    });

    logger.info('Email inviata', { to, subject });
  } catch (error) {
    logger.error('Errore invio email', { to, subject, error: (error as Error).message });
    // Non lanciamo errore per non bloccare il flusso
  }
}

// === PASSWORD RESET ===

export async function sendPasswordResetEmail(
  email: string,
  firstName: string,
  token: string
): Promise<void> {
  const resetUrl = `${FRONTEND_URL}/reset-password?token=${token}`;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #4F46E5; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
        .button { display: inline-block; background: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
        .footer { text-align: center; margin-top: 20px; color: #6b7280; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>DocuVault</h1>
        </div>
        <div class="content">
          <h2>Ciao ${firstName},</h2>
          <p>Hai richiesto il reset della tua password.</p>
          <p>Clicca sul pulsante qui sotto per impostare una nuova password:</p>
          <p style="text-align: center;">
            <a href="${resetUrl}" class="button">Reimposta Password</a>
          </p>
          <p>Oppure copia e incolla questo link nel tuo browser:</p>
          <p style="word-break: break-all; color: #4F46E5;">${resetUrl}</p>
          <p><strong>Questo link scadrà tra 24 ore.</strong></p>
          <p>Se non hai richiesto questo reset, puoi ignorare questa email.</p>
        </div>
        <div class="footer">
          <p>Questo messaggio è stato inviato automaticamente da DocuVault.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  await sendEmail(email, 'Reset Password - DocuVault', html);
}

// === WORKFLOW NOTIFICATION ===

export async function sendWorkflowNotification(
  email: string,
  firstName: string,
  documentName: string,
  fromState: string,
  toState: string,
  changedByName: string
): Promise<void> {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #4F46E5; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
        .status { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 14px; }
        .status-from { background: #fef3c7; color: #92400e; }
        .status-to { background: #d1fae5; color: #065f46; }
        .arrow { margin: 0 8px; color: #6b7280; }
        .footer { text-align: center; margin-top: 20px; color: #6b7280; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>DocuVault</h1>
        </div>
        <div class="content">
          <h2>Ciao ${firstName},</h2>
          <p>Lo stato del documento <strong>${documentName}</strong> è stato aggiornato:</p>
          <p style="text-align: center; margin: 30px 0;">
            <span class="status status-from">${fromState}</span>
            <span class="arrow">→</span>
            <span class="status status-to">${toState}</span>
          </p>
          <p>Modificato da: <strong>${changedByName}</strong></p>
          <p>Accedi a DocuVault per visualizzare i dettagli.</p>
        </div>
        <div class="footer">
          <p>Questo messaggio è stato inviato automaticamente da DocuVault.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  await sendEmail(email, `Cambio stato documento: ${documentName} - DocuVault`, html);
}

// === DOCUMENT SHARE ===

export async function sendDocumentShareNotification(
  email: string,
  firstName: string,
  documentName: string,
  sharedByName: string,
  permission: string
): Promise<void> {
  const permissionText = {
    READ: 'visualizzare',
    WRITE: 'modificare',
    DELETE: 'eliminare',
    SHARE: 'condividere',
    ADMIN: 'gestire completamente',
  }[permission] || permission;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #4F46E5; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
        .footer { text-align: center; margin-top: 20px; color: #6b7280; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>DocuVault</h1>
        </div>
        <div class="content">
          <h2>Ciao ${firstName},</h2>
          <p><strong>${sharedByName}</strong> ha condiviso un documento con te.</p>
          <p>Documento: <strong>${documentName}</strong></p>
          <p>Permesso: <strong>${permissionText}</strong></p>
          <p>Accedi a DocuVault per visualizzare il documento.</p>
        </div>
        <div class="footer">
          <p>Questo messaggio è stato inviato automaticamente da DocuVault.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  await sendEmail(email, `Documento condiviso: ${documentName} - DocuVault`, html);
}

// === RETENTION EXPIRY ===

export async function sendRetentionExpiryNotification(
  email: string,
  firstName: string,
  documents: { name: string; expiresAt: Date; action: string }[]
): Promise<void> {
  const actionText = {
    ARCHIVE: 'archiviato',
    DELETE: 'eliminato',
    NOTIFY: 'notificato',
  };

  const documentList = documents
    .map(doc => `
      <tr>
        <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${doc.name}</td>
        <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${doc.expiresAt.toLocaleDateString('it-IT')}</td>
        <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${actionText[doc.action as keyof typeof actionText] || doc.action}</td>
      </tr>
    `)
    .join('');

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #4F46E5; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th { background: #e5e7eb; padding: 10px; text-align: left; }
        .footer { text-align: center; margin-top: 20px; color: #6b7280; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>DocuVault</h1>
        </div>
        <div class="content">
          <h2>Ciao ${firstName},</h2>
          <p>I seguenti documenti stanno per raggiungere la scadenza della retention policy:</p>
          <table>
            <thead>
              <tr>
                <th>Documento</th>
                <th>Scadenza</th>
                <th>Azione</th>
              </tr>
            </thead>
            <tbody>
              ${documentList}
            </tbody>
          </table>
          <p>Accedi a DocuVault per gestire questi documenti.</p>
        </div>
        <div class="footer">
          <p>Questo messaggio è stato inviato automaticamente da DocuVault.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  await sendEmail(email, `Avviso scadenza documenti - DocuVault`, html);
}

// === WELCOME EMAIL ===

export async function sendWelcomeEmail(
  email: string,
  firstName: string,
  temporaryPassword?: string
): Promise<void> {
  const loginUrl = `${FRONTEND_URL}/login`;

  const passwordSection = temporaryPassword
    ? `<p>La tua password temporanea è: <strong>${temporaryPassword}</strong></p>
       <p>Ti consigliamo di cambiarla al primo accesso.</p>`
    : '';

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #4F46E5; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
        .button { display: inline-block; background: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
        .footer { text-align: center; margin-top: 20px; color: #6b7280; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Benvenuto in DocuVault!</h1>
        </div>
        <div class="content">
          <h2>Ciao ${firstName},</h2>
          <p>Il tuo account DocuVault è stato creato con successo.</p>
          ${passwordSection}
          <p style="text-align: center;">
            <a href="${loginUrl}" class="button">Accedi a DocuVault</a>
          </p>
          <p>Se hai domande, contatta l'amministratore del tuo team.</p>
        </div>
        <div class="footer">
          <p>Questo messaggio è stato inviato automaticamente da DocuVault.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  await sendEmail(email, 'Benvenuto in DocuVault!', html);
}
