// ============================================================
// services/subscriptionService.ts — Logique abonnements
// ============================================================
import pool from '../utils/db';

// ─── Vérifier et expirer les abonnements terminés ─────────────
export async function checkSubscriptionExpiry(): Promise<number> {
  const result = await pool.query(
    `UPDATE subscriptions
     SET status = 'expired', updated_at = NOW()
     WHERE status = 'active' AND end_date < CURRENT_DATE
     RETURNING id, user_id`
  );
  return result.rowCount || 0;
}

// ─── Obtenir le statut abonnement d'un utilisateur ────────────
export async function getUserSubscription(userId: string) {
  const result = await pool.query(
    `SELECT id, plan, status, amount, start_date, end_date, created_at
     FROM subscriptions
     WHERE user_id = $1
     ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );

  if (result.rows.length === 0) {
    return { status: 'none', plan: null, startDate: null, endDate: null };
  }

  const sub = result.rows[0];

  // Vérification automatique expiration
  if (sub.status === 'active' && sub.end_date) {
    const now = new Date();
    const endDate = new Date(sub.end_date);
    if (now > endDate) {
      await pool.query(
        'UPDATE subscriptions SET status = $1, updated_at = NOW() WHERE id = $2',
        ['expired', sub.id]
      );
      sub.status = 'expired';
    }
  }

  return {
    id: sub.id,
    plan: sub.plan,
    status: sub.status,
    amount: sub.amount,
    startDate: sub.start_date,
    endDate: sub.end_date,
    daysRemaining: sub.end_date
      ? Math.max(0, Math.ceil((new Date(sub.end_date).getTime() - Date.now()) / 86400000))
      : null,
  };
}

// ─── Créer une demande d'abonnement ──────────────────────────
export async function createSubscriptionRequest(
  userId: string,
  plan: 'mensuel' | 'annuel'
) {
  const amount = plan === 'mensuel' ? 10 : 100;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Annuler les demandes en attente existantes
    await client.query(
      `UPDATE payment_requests SET status = 'refused'
       WHERE user_id = $1 AND status = 'pending'`,
      [userId]
    );

    // Créer la nouvelle demande
    const reqResult = await client.query(
      `INSERT INTO payment_requests (user_id, plan, amount)
       VALUES ($1, $2, $3) RETURNING id`,
      [userId, plan, amount]
    );

    // Mettre le statut abonnement à "pending"
    const existingSub = await client.query(
      'SELECT id FROM subscriptions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
      [userId]
    );

    if (existingSub.rows.length > 0) {
      await client.query(
        `UPDATE subscriptions SET status = 'pending', plan = $1, amount = $2,
         start_date = NULL, end_date = NULL, updated_at = NOW() WHERE id = $3`,
        [plan, amount, existingSub.rows[0].id]
      );
    } else {
      await client.query(
        'INSERT INTO subscriptions (user_id, plan, status, amount) VALUES ($1, $2, $3, $4)',
        [userId, plan, 'pending', amount]
      );
    }

    await client.query('COMMIT');
    return { requestId: reqResult.rows[0].id };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
