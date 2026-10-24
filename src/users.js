import { one, many, query, tx } from './db.js';

export async function upsertUser(from, referredBy = null) {
  const existing = await one('SELECT * FROM users WHERE id = $1', [from.id]);
  if (existing) {
    await query('UPDATE users SET username=$2, first_name=$3, last_seen=now(), blocked_bot=FALSE WHERE id=$1', [
      from.id, from.username || null, from.first_name || null,
    ]);
    return { ...existing, username: from.username || null, first_name: from.first_name || null, isNew: false };
  }
  const ref = referredBy && Number(referredBy) !== from.id ? await one('SELECT id FROM users WHERE id=$1', [referredBy]) : null;
  const u = await one(
    `INSERT INTO users (id, username, first_name, referred_by) VALUES ($1,$2,$3,$4)
     ON CONFLICT (id) DO UPDATE SET last_seen=now() RETURNING *`,
    [from.id, from.username || null, from.first_name || null, ref ? ref.id : null],
  );
  return { ...u, isNew: true };
}

export const getUser = (id) => one('SELECT * FROM users WHERE id = $1', [id]);

export async function setState(userId, state) {
  await query('UPDATE users SET state = $2 WHERE id = $1', [userId, state ? JSON.stringify(state) : null]);
}

// Descuenta saldo de forma atómica. Devuelve el nuevo saldo o null si no alcanza.
export async function debit(userId, amount, type, note, orderId = null) {
  return tx(async (t) => {
    const r = await t.query(
      'UPDATE users SET balance = balance - $1 WHERE id = $2 AND balance >= $1 RETURNING balance',
      [amount, userId],
    );
    if (!r.rows[0]) return null;
    await t.query('INSERT INTO transactions (user_id, amount, type, note, order_id) VALUES ($1,$2,$3,$4,$5)', [
      userId, -amount, type, note, orderId,
    ]);
    return Number(r.rows[0].balance);
  });
}

export async function credit(userId, amount, type, note, orderId = null) {
  return tx(async (t) => {
    const r = await t.query('UPDATE users SET balance = balance + $1 WHERE id = $2 RETURNING balance', [amount, userId]);
    if (!r.rows[0]) throw new Error('Usuario no encontrado');
    await t.query('INSERT INTO transactions (user_id, amount, type, note, order_id) VALUES ($1,$2,$3,$4,$5)', [
      userId, amount, type, note, orderId,
    ]);
    return Number(r.rows[0].balance);
  });
}

export const userOrders = (userId, limit = 10) =>
  many('SELECT * FROM orders WHERE user_id=$1 ORDER BY id DESC LIMIT $2', [userId, limit]);

export async function referralStats(userId) {
  const r = await one(
    `SELECT (SELECT count(*) FROM users WHERE referred_by=$1)::int AS invited,
            (SELECT COALESCE(sum(amount),0) FROM transactions WHERE user_id=$1 AND type='referral') AS earned`,
    [userId],
  );
  return { invited: Number(r.invited), earned: Number(r.earned) };
}
