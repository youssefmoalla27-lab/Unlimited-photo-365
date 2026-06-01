import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

import authRoutes from './routes/auth';
import photoRoutes from './routes/photos';
import subscriptionRoutes from './routes/subscriptions';
import adminRoutes from './routes/admin';
import { errorHandler } from './middleware/errorHandler';
import { checkSubscriptionExpiry } from './services/subscriptionService';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Middleware de sécurité ───────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));
app.use(compression());
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Rate limiting ────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 100,
  message: 'Trop de requêtes depuis cette IP, réessayez dans 15 minutes.',
});
app.use('/api/', limiter);

// Rate limiting strict pour l'auth
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Trop de tentatives de connexion, réessayez dans 15 minutes.',
});
app.use('/api/auth/', authLimiter);

// ─── Routes ──────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/photos', photoRoutes);
app.use('/api/subscription', subscriptionRoutes);
app.use('/api/admin', adminRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Error handler ────────────────────────────────────────────
app.use(errorHandler);

// ─── Vérification expiration abonnements (toutes les heures) ──
setInterval(async () => {
  try {
    await checkSubscriptionExpiry();
    console.log('[CRON] Vérification expiration abonnements ✓');
  } catch (err) {
    console.error('[CRON] Erreur vérification expiration:', err);
  }
}, 60 * 60 * 1000);

// ─── Démarrage ────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 UP365 API démarrée sur http://localhost:${PORT}`);
  console.log(`📊 Environnement: ${process.env.NODE_ENV || 'development'}`);
});

export default app;
