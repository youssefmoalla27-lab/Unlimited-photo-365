# Unlimited Photos 365 — Documentation complète

## Architecture du projet

```
unlimited-photos-365/
├── frontend/               # Next.js 14 + React + Tailwind CSS
│   ├── src/
│   │   ├── app/            # App Router (pages)
│   │   ├── components/     # Composants réutilisables
│   │   ├── hooks/          # Hooks personnalisés
│   │   ├── lib/            # Utilitaires, API client
│   │   └── types/          # Types TypeScript
│   ├── .env.local          # Variables frontend
│   └── package.json
├── backend/                # Node.js + Express API
│   ├── src/
│   │   ├── routes/         # Routes API
│   │   ├── middleware/      # Auth JWT, validation
│   │   ├── services/       # Logique métier
│   │   └── utils/          # Helpers
│   ├── .env                # Variables backend
│   └── package.json
├── database/
│   ├── schema.sql          # Structure complète PostgreSQL
│   └── seeds.sql           # Données de test
└── README.md
```

---

## Prérequis

- Node.js 18+
- PostgreSQL 15+
- Compte AWS S3 (ou MinIO en local)
- npm ou yarn

---

## Installation rapide

### 1. Cloner et installer

```bash
git clone https://github.com/votre-compte/unlimited-photos-365.git
cd unlimited-photos-365

# Backend
cd backend && npm install

# Frontend
cd ../frontend && npm install
```

### 2. Base de données

```bash
# Créer la base
psql -U postgres -c "CREATE DATABASE up365;"

# Appliquer le schéma
psql -U postgres -d up365 -f database/schema.sql

# (Optionnel) Données de test
psql -U postgres -d up365 -f database/seeds.sql
```

### 3. Variables d'environnement

**backend/.env** :
```env
DATABASE_URL=postgresql://postgres:password@localhost:5432/up365
JWT_SECRET=votre_secret_jwt_tres_long_et_securise
JWT_EXPIRES_IN=7d
AWS_REGION=eu-west-3
AWS_ACCESS_KEY_ID=votre_access_key
AWS_SECRET_ACCESS_KEY=votre_secret_key
AWS_BUCKET_NAME=up365-photos
WHATSAPP_NUMBER=+33612345678
PORT=3001
NODE_ENV=development
ADMIN_EMAIL=admin@up365.com
ADMIN_PASSWORD=MotDePasseAdmin!2024
```

**frontend/.env.local** :
```env
NEXT_PUBLIC_API_URL=http://localhost:3001/api
NEXT_PUBLIC_APP_NAME=Unlimited Photos 365
```

### 4. Lancer l'application

```bash
# Démarrer le backend (terminal 1)
cd backend && npm run dev

# Démarrer le frontend (terminal 2)
cd frontend && npm run dev
```

L'app est disponible sur **http://localhost:3000**

---

## Déploiement en production

### Option A — VPS (Nginx + PM2)

```bash
# Backend avec PM2
cd backend
npm run build
pm2 start dist/index.js --name "up365-api"

# Frontend avec Next.js
cd frontend
npm run build
pm2 start npm --name "up365-front" -- start

# Nginx config
sudo nano /etc/nginx/sites-available/up365
```

Nginx config :
```nginx
server {
    server_name votredomaine.com;

    location /api/ {
        proxy_pass http://localhost:3001/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
    }
}
```

### Option B — Docker Compose

```bash
docker-compose up -d
```

### Option C — Vercel + Railway

- **Frontend** : déployer sur Vercel (auto-détecte Next.js)
- **Backend** : déployer sur Railway (PostgreSQL inclus)

---

## Comptes de démonstration

| Rôle | Email | Mot de passe |
|------|-------|-------------|
| Admin | admin@up365.com | Admin!2024 |
| Utilisateur actif | marie@exemple.com | Test!2024 |
| Utilisateur en attente | jean@exemple.com | Test!2024 |

---

## API — Endpoints principaux

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| POST | /api/auth/register | Inscription |
| POST | /api/auth/login | Connexion |
| GET | /api/photos | Liste photos (auth) |
| POST | /api/photos/upload | Upload photo (auth + sub actif) |
| DELETE | /api/photos/:id | Supprimer photo (auth) |
| GET | /api/subscription/status | Statut abonnement |
| POST | /api/subscription/request | Demander abonnement |
| GET | /api/admin/requests | Liste demandes (admin) |
| PUT | /api/admin/requests/:id/confirm | Confirmer paiement (admin) |
| PUT | /api/admin/requests/:id/refuse | Refuser paiement (admin) |
| GET | /api/admin/users | Tous utilisateurs (admin) |
| PUT | /api/admin/users/:id/subscription | Modifier abonnement (admin) |
| GET | /api/admin/config | Config WhatsApp (admin) |
| PUT | /api/admin/config | Mettre à jour config (admin) |
