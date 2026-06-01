import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import pool from '../utils/db';

interface JwtPayload {
  id: string;
  role: string;
  iat: number;
  exp: number;
}

// ─── Middleware: Vérification JWT ─────────────────────────────
export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Token d\'authentification requis.' });
  }

  const token = authHeader.substring(7);

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET as string) as JwtPayload;
    (req as any).user = { id: payload.id, role: payload.role };
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      return res.status(401).json({ message: 'Session expirée. Veuillez vous reconnecter.', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ message: 'Token invalide.' });
  }
}

// ─── Middleware: Rôle admin requis ────────────────────────────
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if ((req as any).user?.role !== 'admin') {
    return res.status(403).json({ message: 'Accès réservé aux administrateurs.' });
  }
  next();
}

// ─── Middleware: Abonnement actif requis ──────────────────────
export async function requireActiveSubscription(req: Request, res: Response, next: NextFunction) {
  const userId = (req as any).user?.id;

  try {
    const result = await pool.query(
      `SELECT status, end_date FROM subscriptions
       WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );

    if (result.rows.length === 0 || result.rows[0].status !== 'active') {
      return res.status(403).json({
        message: 'Un abonnement actif est requis pour importer des photos.',
        code: 'SUBSCRIPTION_REQUIRED',
        subscriptionStatus: result.rows[0]?.status || 'none',
      });
    }

    // Vérifier l'expiration
    const endDate = new Date(result.rows[0].end_date);
    if (endDate < new Date()) {
      await pool.query(
        'UPDATE subscriptions SET status = $1 WHERE user_id = $2 AND status = $3',
        ['expired', userId, 'active']
      );
      return res.status(403).json({
        message: 'Votre abonnement a expiré. Veuillez le renouveler.',
        code: 'SUBSCRIPTION_EXPIRED',
      });
    }

    next();
  } catch (err) {
    console.error('Erreur vérification abonnement:', err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
}
