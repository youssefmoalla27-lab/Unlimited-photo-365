import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import pool from '../utils/db';
import { authenticate, requireAdmin } from '../middleware/auth';

const router = Router();

// Toutes les routes admin nécessitent une auth + rôle admin
router.use(authenticate, requireAdmin);

// ─── GET /api/admin/stats ─────────────────────────────────────
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const stats = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM users WHERE role = 'user') as total_users,
        (SELECT COUNT(*) FROM subscriptions WHERE status = 'active') as active_subscriptions,
        (SELECT COUNT(*) FROM subscriptions WHERE status = 'pending') as pending_subscriptions,
        (SELECT COUNT(*) FROM subscriptions WHERE status = 'expired') as expired_subscriptions,
        (SELECT COUNT(*) FROM payment_requests WHERE status = 'pending') as pending_payments,
        (SELECT COUNT(*) FROM photos WHERE is_deleted = false) as total_photos,
        (SELECT COALESCE(SUM(size_bytes), 0) FROM photos WHERE is_deleted = false) as total_storage_bytes
    `);

    const s = stats.rows[0];
    res.json({
      totalUsers: parseInt(s.total_users),
      activeSubscriptions: parseInt(s.active_subscriptions),
      pendingSubscriptions: parseInt(s.pending_subscriptions),
      expiredSubscriptions: parseInt(s.expired_subscriptions),
      pendingPayments: parseInt(s.pending_payments),
      totalPhotos: parseInt(s.total_photos),
      totalStorageGB: (parseInt(s.total_storage_bytes) / 1024 / 1024 / 1024).toFixed(2),
    });
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur.' });
  }
});

// ─── GET /api/admin/users ─────────────────────────────────────
router.get('/users', async (req: Request, res: Response) => {
  const { page = 1, limit = 20, search } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  try {
    let query = `
      SELECT u.id, u.first_name, u.last_name, u.email, u.role, u.created_at, u.is_active,
        s.plan, s.status as sub_status, s.start_date, s.end_date,
        (SELECT COUNT(*) FROM photos p WHERE p.user_id = u.id AND NOT p.is_deleted) as photo_count,
        (SELECT COALESCE(SUM(size_bytes), 0) FROM photos p WHERE p.user_id = u.id AND NOT p.is_deleted) as storage_bytes
      FROM users u
      LEFT JOIN LATERAL (
        SELECT * FROM subscriptions s2 WHERE s2.user_id = u.id
        ORDER BY s2.created_at DESC LIMIT 1
      ) s ON true
      WHERE u.role = 'user'
    `;
    const params: any[] = [];

    if (search) {
      params.push(`%${search}%`);
      query += ` AND (u.email ILIKE $${params.length} OR u.first_name ILIKE $${params.length} OR u.last_name ILIKE $${params.length})`;
    }

    query += ` ORDER BY u.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(Number(limit), offset);

    const result = await pool.query(query, params);

    res.json({
      users: result.rows.map(u => ({
        id: u.id,
        firstName: u.first_name,
        lastName: u.last_name,
        email: u.email,
        isActive: u.is_active,
        createdAt: u.created_at,
        subscription: {
          plan: u.plan,
          status: u.sub_status,
          startDate: u.start_date,
          endDate: u.end_date,
        },
        photoCount: parseInt(u.photo_count),
        storageGB: (parseInt(u.storage_bytes) / 1024 / 1024 / 1024).toFixed(3),
      })),
    });
  } catch (err) {
    console.error('Erreur récupération utilisateurs:', err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
});

// ─── GET /api/admin/requests ──────────────────────────────────
router.get('/requests', async (req: Request, res: Response) => {
  const { status } = req.query;

  try {
    let query = `
      SELECT pr.id, pr.plan, pr.amount, pr.status, pr.created_at, pr.admin_note,
        u.first_name, u.last_name, u.email
      FROM payment_requests pr
      JOIN users u ON u.id = pr.user_id
    `;
    const params: any[] = [];

    if (status) {
      params.push(status);
      query += ` WHERE pr.status = $${params.length}`;
    }

    query += ' ORDER BY pr.created_at DESC';

    const result = await pool.query(query, params);

    res.json({
      requests: result.rows.map(r => ({
        id: r.id,
        userName: `${r.first_name} ${r.last_name}`,
        email: r.email,
        plan: r.plan,
        amount: r.amount,
        status: r.status,
        adminNote: r.admin_note,
        createdAt: r.created_at,
      })),
    });
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur.' });
  }
});

// ─── PUT /api/admin/requests/:id/confirm ─────────────────────
router.put('/requests/:id/confirm', [
  body('note').optional().trim(),
], async (req: Request, res: Response) => {
  const adminId = (req as any).user.id;
  const { id } = req.params;
  const { note } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Récupérer la demande
    const reqResult = await client.query(
      'SELECT * FROM payment_requests WHERE id = $1 AND status = $2',
      [id, 'pending']
    );

    if (reqResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Demande introuvable ou déjà traitée.' });
    }

    const payReq = reqResult.rows[0];
    const days = payReq.plan === 'mensuel' ? 30 : 365;
    const startDate = new Date();
    const endDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    // Créer ou mettre à jour l'abonnement
    await client.query(
      `INSERT INTO subscriptions (user_id, plan, status, amount, start_date, end_date, confirmed_by, confirmed_at)
       VALUES ($1, $2, 'active', $3, $4, $5, $6, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         plan = $2, status = 'active', amount = $3,
         start_date = $4, end_date = $5, confirmed_by = $6, confirmed_at = NOW()`,
      [payReq.user_id, payReq.plan, payReq.amount,
       startDate.toISOString().split('T')[0],
       endDate.toISOString().split('T')[0],
       adminId]
    );

    // Mettre à jour la demande
    await client.query(
      `UPDATE payment_requests SET status = 'confirmed', admin_id = $1,
       admin_note = $2, processed_at = NOW() WHERE id = $3`,
      [adminId, note || null, id]
    );

    await client.query('COMMIT');

    res.json({
      message: `Paiement confirmé. Abonnement activé jusqu'au ${endDate.toISOString().split('T')[0]}.`,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur confirmation paiement:', err);
    res.status(500).json({ message: 'Erreur serveur.' });
  } finally {
    client.release();
  }
});

// ─── PUT /api/admin/requests/:id/refuse ──────────────────────
router.put('/requests/:id/refuse', [
  body('reason').optional().trim(),
], async (req: Request, res: Response) => {
  const adminId = (req as any).user.id;
  const { id } = req.params;
  const { reason } = req.body;

  try {
    const reqResult = await pool.query(
      'SELECT * FROM payment_requests WHERE id = $1 AND status = $2',
      [id, 'pending']
    );

    if (reqResult.rows.length === 0) {
      return res.status(404).json({ message: 'Demande introuvable ou déjà traitée.' });
    }

    const payReq = reqResult.rows[0];

    await pool.query(
      `UPDATE payment_requests SET status = 'refused', admin_id = $1,
       admin_note = $2, processed_at = NOW() WHERE id = $3`,
      [adminId, reason || null, id]
    );

    // Mettre à jour le statut abonnement
    await pool.query(
      `UPDATE subscriptions SET status = 'refused' WHERE user_id = $1 AND status = 'pending'`,
      [payReq.user_id]
    );

    res.json({ message: 'Demande refusée.' });
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur.' });
  }
});

// ─── PUT /api/admin/users/:id/subscription ───────────────────
router.put('/users/:id/subscription', [
  body('endDate').isISO8601().withMessage('Date invalide'),
  body('plan').isIn(['mensuel', 'annuel']).optional(),
], async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const adminId = (req as any).user.id;
  const { id } = req.params;
  const { endDate, plan } = req.body;

  try {
    await pool.query(
      `UPDATE subscriptions SET end_date = $1, status = 'active',
       confirmed_by = $2, updated_at = NOW()
       ${plan ? ', plan = $3' : ''}
       WHERE user_id = $${plan ? 4 : 3}`,
      plan ? [endDate, adminId, plan, id] : [endDate, adminId, id]
    );

    res.json({ message: 'Abonnement mis à jour.' });
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur.' });
  }
});

// ─── GET /api/admin/config ────────────────────────────────────
router.get('/config', async (req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT key, value FROM app_config');
    const config = result.rows.reduce((acc: any, row) => {
      acc[row.key] = row.value;
      return acc;
    }, {});
    res.json(config);
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur.' });
  }
});

// ─── PUT /api/admin/config ────────────────────────────────────
router.put('/config', async (req: Request, res: Response) => {
  const { whatsapp_number, whatsapp_message_template } = req.body;

  try {
    const updates = [];
    if (whatsapp_number) {
      updates.push(pool.query(
        `INSERT INTO app_config (key, value) VALUES ('whatsapp_number', $1)
         ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
        [whatsapp_number]
      ));
    }
    if (whatsapp_message_template) {
      updates.push(pool.query(
        `INSERT INTO app_config (key, value) VALUES ('whatsapp_message_template', $1)
         ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
        [whatsapp_message_template]
      ));
    }

    await Promise.all(updates);
    res.json({ message: 'Configuration mise à jour.' });
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur.' });
  }
});

export default router;
