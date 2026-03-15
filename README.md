# DocuVault Backend

Sistema di gestione documentale enterprise.

## Requisiti

- Node.js 20+
- PostgreSQL 15+
- Redis 7+
- MinIO (o AWS S3)

## Setup Locale

1. **Clona il repository**
```bash
git clone https://github.com/federicodipierro87-beep/docfeed-backend.git
cd docfeed-backend
```

2. **Installa dipendenze**
```bash
npm install
```

3. **Configura environment**
```bash
cp .env.example .env
# Modifica .env con le tue configurazioni
```

4. **Avvia servizi (Docker)**
```bash
docker-compose up -d postgres redis minio
```

5. **Esegui migrazioni**
```bash
npm run prisma:migrate
```

6. **Popola database con dati demo**
```bash
npm run prisma:seed
```

7. **Avvia server**
```bash
npm run dev
```

## Credenziali Demo

| Email | Password | Ruolo |
|-------|----------|-------|
| admin@demo.com | Password123! | ADMIN |
| manager@demo.com | Password123! | MANAGER |
| user1@demo.com | Password123! | USER |

## API Endpoints

### Autenticazione
- `POST /api/auth/login` - Login
- `POST /api/auth/register` - Registrazione (solo admin)
- `POST /api/auth/refresh` - Rinnovo token
- `POST /api/auth/logout` - Logout
- `GET /api/auth/me` - Profilo utente

### Documenti
- `GET /api/documents` - Lista documenti
- `POST /api/documents` - Upload documento
- `GET /api/documents/:id` - Dettaglio documento
- `PATCH /api/documents/:id` - Aggiorna documento
- `DELETE /api/documents/:id` - Elimina documento
- `GET /api/documents/:id/download` - Download
- `POST /api/documents/:id/versions` - Nuova versione

### Vault
- `GET /api/vaults` - Lista vault
- `POST /api/vaults` - Crea vault
- `GET /api/vaults/:id` - Dettaglio vault

### Ricerca
- `GET /api/search?q=query` - Ricerca full-text
- `POST /api/search/advanced` - Ricerca avanzata

### Workflow
- `GET /api/workflows` - Lista workflow
- `POST /api/documents/:id/transition` - Transizione stato

## Deploy su Railway

Il progetto include configurazione Railway (`railway.json`).

1. Crea progetto su Railway
2. Aggiungi PostgreSQL e Redis addon
3. Configura variabili ambiente
4. Deploy automatico da GitHub

## Variabili Ambiente

Vedi `.env.example` per la lista completa delle variabili richieste.

## Licenza

Proprietario - Demo Corp
