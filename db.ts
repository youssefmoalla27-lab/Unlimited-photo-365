// ============================================================
// utils/db.ts — Connexion PostgreSQL avec pool
// ============================================================
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Erreur pool PostgreSQL:', err);
});

// Test de connexion au démarrage
pool.query('SELECT 1').then(() => {
  console.log('✅ Connexion PostgreSQL établie');
}).catch(err => {
  console.error('❌ Erreur connexion PostgreSQL:', err);
});

export default pool;
