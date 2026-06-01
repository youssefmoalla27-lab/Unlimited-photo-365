import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import pool from '../utils/db';
import { authenticate } from '../middleware/auth';

const router = Router();
const SALT_ROUNDS = 12;

// ─── POST /api/auth/register ──────────────────────────────────
router.post('/register', [
  body('firstName').trim().notEmpty().withMessage('Le prénom est requis').isLength({ max: 100 }),
  body('lastName').trim().notEmpty().withMessage('Le nom est requis').isLength({ max: 100 }),
  body('email').isEmail().withMessage('Email invalide').normalizeEmail(),
  body('password').isLength({ min: 8 }).withMessage('Mot de passe trop court (min. 8 caractères)')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Le mot de passe doit contenir au moins une majuscule, une minuscule et un chiffre'),
], async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { firstName, lastName, email, password } = req.body;

  try {
    // Vérifier email unique
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ message: 'Cet email est déjà utilisé.' });
    }

    // Hasher le mot de passe
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    // Créer l'utilisateur
    const result = await pool.query(
      `INSERT INTO users (first_name, last_name, email, password)
       VALUES ($1, $2, $3, $4) RETURNING id, first_name, last_name, email, role, created_at`,
      [firstName, lastName, email, hashedPassword]
    );

    const user = result.rows[0];

    // Générer les tokens
    const tokens = generateTokens(user.id, user.role);

    res.status(201).json({
      message: 'Compte créé avec succès',
      user: {
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
        role: user.role,
      },
      ...tokens,
    });
  } catch (err) {
    console.error('Erreur inscription:', err);
    res.status(500).json({ message: 'Erreur serveur lors de l\'inscription.' });
  }
});

// ─── POST /api/auth/login ─────────────────────────────────────
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
], async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { email, password } = req.body;

  try {
    const result = await pool.query(
      `SELECT u.*, 
        (SELECT json_build_object(
          'status', s.status,
          'plan', s.plan,
          'startDate', s.start_date,
          'endDate', s.end_date
        ) FROM subscriptions s 
        WHERE s.user_id = u.id 
        ORDER BY s.created_at DESC LIMIT 1) as subscription
       FROM users u WHERE u.email = $1 AND u.is_active = true`,
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Email ou mot de passe incorrect.' });
    }

    const user = result.rows[0];

    // Vérifier le mot de passe
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return res.status(401).json({ message: 'Email ou mot de passe incorrect.' });
    }

    // Générer les tokens
    const tokens = generateTokens(user.id, user.role);

    // Sauvegarder le refresh token
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 jours
    await pool.query(
      'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.id, tokens.refreshToken, expiresAt]
    );

    res.json({
      message: 'Connexion réussie',
      user: {
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
        role: user.role,
        subscription: user.subscription,
      },
      ...tokens,
    });
  } catch (err) {
    console.error('Erreur connexion:', err);
    res.status(500).json({ message: 'Erreur serveur lors de la connexion.' });
  }
});

// ─── POST /api/auth/refresh ───────────────────────────────────
router.post('/refresh', async (req: Request, res: Response) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res.status(401).json({ message: 'Refresh token manquant.' });
  }

  try {
    const result = await pool.query(
      `SELECT rt.*, u.role FROM refresh_tokens rt
       JOIN users u ON u.id = rt.user_id
       WHERE rt.token = $1 AND rt.is_revoked = false AND rt.expires_at > NOW()`,
      [refreshToken]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Refresh token invalide ou expiré.' });
    }

    const tokenData = result.rows[0];
    const tokens = generateTokens(tokenData.user_id, tokenData.role);

    // Révoquer l'ancien et sauvegarder le nouveau
    await pool.query('UPDATE refresh_tokens SET is_revoked = true WHERE token = $1', [refreshToken]);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await pool.query(
      'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [tokenData.user_id, tokens.refreshToken, expiresAt]
    );

    res.json(tokens);
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur.' });
  }
});

// ─── POST /api/auth/logout ────────────────────────────────────
router.post('/logout', authenticate, async (req: Request, res: Response) => {
  const { refreshToken } = req.body;
  if (refreshToken) {
    await pool.query('UPDATE refresh_tokens SET is_revoked = true WHERE token = $1', [refreshToken]);
  }
  res.json({ message: 'Déconnecté avec succès.' });
});

// ─── GET /api/auth/me ─────────────────────────────────────────
router.get('/me', authenticate, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.first_name, u.last_name, u.email, u.role, u.created_at,
        (SELECT json_build_object(
          'status', s.status,
          'plan', s.plan,
          'startDate', s.start_date,
          'endDate', s.end_date
        ) FROM subscriptions s 
        WHERE s.user_id = u.id 
        ORDER BY s.created_at DESC LIMIT 1) as subscription,
        (SELECT COUNT(*) FROM photos p WHERE p.user_id = u.id AND NOT p.is_deleted) as photo_count,
        (SELECT COALESCE(SUM(size_bytes), 0) FROM photos p WHERE p.user_id = u.id AND NOT p.is_deleted) as storage_bytes
       FROM users u WHERE u.id = $1`,
      [(req as any).user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Utilisateur introuvable.' });
    }

    const u = result.rows[0];
    res.json({
      id: u.id,
      firstName: u.first_name,
      lastName: u.last_name,
      email: u.email,
      role: u.role,
      subscription: u.subscription,
      photoCount: parseInt(u.photo_count),
      storageBytes: parseInt(u.storage_bytes),
    });
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur.' });
  }
});

// ─── Helpers ──────────────────────────────────────────────────
function generateTokens(userId: string, role: string) {
  const accessToken = jwt.sign(
    { id: userId, role },
    process.env.JWT_SECRET as string,
    { expiresIn: process.env.JWT_EXPIRES_IN || '1d' }
  );
  const refreshToken = uuidv4();
  return { accessToken, refreshToken };
}

export default router;
