import 'dotenv/config';
import jwt from 'jsonwebtoken';
import express from 'express';
import pg from 'pg';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { verifyTelegramInitData } from './telegram-auth.js';

const app = express();
app.set('trust proxy', 'loopback');
const port = Number(process.env.PORT ?? 3000);
const databaseUrl = process.env.DATABASE_URL;
interface AuthenticatedRequest extends express.Request {
  userId?: string;
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function requireAuth(
  req: AuthenticatedRequest,
  res: express.Response,
  next: express.NextFunction
) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;
  const secret = process.env.JWT_SECRET;

  if (!token || !secret) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const payload = jwt.verify(token, secret, {
      issuer: 'curier-api',
      audience: 'curier-app'
    });

    if (
      typeof payload === 'string' ||
      typeof payload.sub !== 'string'
    ) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    req.userId = payload.sub;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

if (!databaseUrl) {
  throw new Error('DATABASE_URL is not configured');
}

const pool = new pg.Pool({
  connectionString: databaseUrl,
  host: '127.0.0.1',
  max: 5,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 10000,
  ssl: false
});

app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: false }));
app.use(express.json({ limit: '32kb' }));
app.use(rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false
}));
app.post('/auth/telegram', async (req, res) => {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  if (!botToken) {
    return res.status(503).json({ error: 'Authentication unavailable' });
  }

  const initData = req.body?.initData;

  if (typeof initData !== 'string') {
    return res.status(400).json({ error: 'Missing initData' });
  }

  const user = verifyTelegramInitData(initData, botToken);

  if (!user) {
    return res.status(401).json({ error: 'Invalid or expired Telegram data' });
  }

  try {
    const language = user.language_code === 'en' ? 'en' : 'ru';

    const result = await pool.query(
      `INSERT INTO public.profiles
         (telegram_id, username, first_name, last_name, language)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (telegram_id)
       DO UPDATE SET
         username = EXCLUDED.username,
         first_name = EXCLUDED.first_name,
         last_name = EXCLUDED.last_name
       RETURNING id, language, is_blocked`,
      [
        String(user.id),
        user.username ?? null,
        user.first_name,
        user.last_name ?? null,
        language
      ]
    );

    const profile = result.rows[0];

    if (profile.is_blocked) {
      return res.status(403).json({ error: 'Account blocked' });
    }

    const jwtSecret = process.env.JWT_SECRET;

if (!jwtSecret) {
  return res.status(503).json({
    error: 'Authentication unavailable'
  });
}

const token = jwt.sign(
  { sub: profile.id },
  jwtSecret,
  { expiresIn: '7d', issuer: 'curier-api', audience: 'curier-app' }
);

return res.json({
  authenticated: true,
  token,
  expiresIn: 604800,
  profile: {
    id: profile.id,
    language: profile.language
  }
});
  } catch {
    return res.status(500).json({ error: 'Authentication failed' });
  }
});


app.get('/orders', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId!;

  try {
    const result = await pool.query(
      `SELECT o.id, o.title, o.pickup_address, o.dropoff_address,
              o.description, o.initial_price, o.agreed_price,
              o.status, o.created_at, o.early_access_until,
              o.customer_id, o.courier_id
       FROM public.orders o
       JOIN public.profiles p ON p.id = $1 AND p.is_blocked = false
       WHERE o.customer_id = $1
          OR (
            o.status IN ('open', 'negotiating')
            AND o.courier_id IS NULL
            AND o.early_access_until <= now()
          )
       ORDER BY o.created_at DESC
       LIMIT 100`,
      [userId]
    );

    return res.json({ orders: result.rows });
  } catch {
    return res.status(500).json({ error: 'Could not load orders' });
  }
});

app.post('/orders', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId!;
  const {
    title, pickup_address, dropoff_address,
    description, initial_price
  } = req.body ?? {};

  if (
    typeof title !== 'string' || !title.trim() || title.length > 200 ||
    typeof pickup_address !== 'string' || !pickup_address.trim() ||
    pickup_address.length > 500 ||
    typeof dropoff_address !== 'string' || !dropoff_address.trim() ||
    dropoff_address.length > 500 ||
    typeof description !== 'string' || !description.trim() ||
    description.length > 5000
  ) {
    return res.status(400).json({ error: 'Invalid order fields' });
  }

  let price: number | null = null;

  if (initial_price !== undefined && initial_price !== null && initial_price !== '') {
    price = Number(initial_price);
    if (!Number.isFinite(price) || price < 0 || price > 1000000000) {
      return res.status(400).json({ error: 'Invalid initial_price' });
    }
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const profile = await client.query(
      'SELECT id FROM public.profiles WHERE id = $1 AND is_blocked = false FOR UPDATE',
      [userId]
    );

    if (profile.rowCount !== 1) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Profile unavailable' });
    }

    const created = await client.query(
      `INSERT INTO public.orders
         (customer_id, title, pickup_address, dropoff_address,
          description, initial_price)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, customer_id, title, pickup_address, dropoff_address,
                 description, initial_price, status, created_at,
                 early_access_until`,
      [
        userId, title.trim(), pickup_address.trim(),
        dropoff_address.trim(), description.trim(), price
      ]
    );

    await client.query(
      `INSERT INTO public.order_events (order_id, actor_id, event_type, payload)
       VALUES ($1, $2, 'order_created', $3::jsonb)`,
      [
        created.rows[0].id,
        userId,
        JSON.stringify({ title: title.trim() })
      ]
    );

    await client.query('COMMIT');
    return res.status(201).json({ order: created.rows[0] });
  } catch {
    await client.query('ROLLBACK');
    return res.status(500).json({ error: 'Could not create order' });
  } finally {
    client.release();
  }
});


app.get('/orders/:orderId/offers', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId!;
  const { orderId } = req.params;

  if (!isUuid(orderId)) {
    return res.status(400).json({ error: 'Invalid order ID' });
  }

  try {
    const result = await pool.query(
      `SELECT o.customer_id, o.courier_id
       FROM public.orders o
       JOIN public.profiles p ON p.id = $2 AND p.is_blocked = false
       WHERE o.id = $1`,
      [orderId, userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const order = result.rows[0];

    const isCustomer = order.customer_id === userId;
    const isAssignedCourier = order.courier_id === userId;

    if (!isCustomer && !isAssignedCourier) {
      const ownOffer = await pool.query(
        `SELECT 1 FROM public.offers
         WHERE order_id = $1 AND courier_id = $2
         LIMIT 1`,
        [orderId, userId]
      );

      if (ownOffer.rowCount === 0) {
        return res.status(403).json({ error: 'Not allowed to view offers' });
      }
    }

    const offers = await pool.query(
      `SELECT id, order_id, courier_id, proposer_id, parent_offer_id,
              amount, comment, status, created_at
       FROM public.offers
       WHERE order_id = $1
         AND ($2::boolean OR courier_id = $3)
       ORDER BY created_at DESC
       LIMIT 100`,
      [orderId, isCustomer || isAssignedCourier, userId]
    );

    return res.json({ offers: offers.rows });
  } catch {
    return res.status(500).json({ error: 'Could not load offers' });
  }
});

app.post('/orders/:orderId/offers', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId!;
  const { orderId } = req.params;
  const { amount, comment } = req.body ?? {};
  const price = Number(amount);

  if (!isUuid(orderId)) {
    return res.status(400).json({ error: 'Invalid order ID' });
  }

  if (!Number.isFinite(price) || price <= 0 || price > 1000000000) {
    return res.status(400).json({ error: 'Invalid amount' });
  }

  if (comment !== undefined && comment !== null &&
      (typeof comment !== 'string' || comment.length > 1000)) {
    return res.status(400).json({ error: 'Invalid comment' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const orderResult = await client.query(
      `SELECT o.id, o.customer_id, o.status, o.courier_id,
              o.early_access_until
       FROM public.orders o
       JOIN public.profiles p ON p.id = $2 AND p.is_blocked = false
       WHERE o.id = $1
       FOR UPDATE OF o`,
      [orderId, userId]
    );

    if (orderResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Order not found' });
    }

    const order = orderResult.rows[0];

    if (order.customer_id === userId) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Customers cannot offer on their own order' });
    }

    if (order.status !== 'open' && order.status !== 'negotiating') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Order is not accepting offers' });
    }

    if (order.courier_id !== null) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Order already has a courier' });
    }

    if (new Date(order.early_access_until).getTime() > Date.now()) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Early access period is active' });
    }

    const existing = await client.query(
      `SELECT id FROM public.offers
       WHERE order_id = $1 AND courier_id = $2
         AND status = 'pending'
         AND NOT EXISTS (
           SELECT 1 FROM public.offers child
           WHERE child.parent_offer_id = public.offers.id
         )
       LIMIT 1`,
      [orderId, userId]
    );

    if (existing.rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'You already have an active offer' });
    }

    const created = await client.query(
      `INSERT INTO public.offers
         (order_id, courier_id, proposer_id, amount, comment)
       VALUES ($1, $2, $2, $3, $4)
       RETURNING id, order_id, courier_id, proposer_id, parent_offer_id,
                 amount, comment, status, created_at`,
      [orderId, userId, price, comment?.trim() || null]
    );

    await client.query(
      `UPDATE public.orders
       SET status = 'negotiating', updated_at = now()
       WHERE id = $1 AND status = 'open'`,
      [orderId]
    );

    await client.query(
      `INSERT INTO public.order_events (order_id, actor_id, event_type, payload)
       VALUES ($1, $2, 'offer_created', $3::jsonb)`,
      [orderId, userId, JSON.stringify({ offer_id: created.rows[0].id, amount: price })]
    );

    await client.query('COMMIT');
    return res.status(201).json({ offer: created.rows[0] });
  } catch {
    await client.query('ROLLBACK');
    return res.status(500).json({ error: 'Could not create offer' });
  } finally {
    client.release();
  }
});

app.post('/offers/:offerId/accept', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId!;
  const offerId = req.params.offerId;

  if (
    typeof offerId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(offerId)
  ) {
    return res.status(400).json({ error: 'Invalid offer ID' });
  }

  try {
    const result = await pool.query(
      `SELECT public.accept_offer_transaction($1::uuid, $2::uuid) AS result`,
      [offerId, userId]
    );

    return res.json({
      accepted: true,
      result: result.rows[0].result
    });
  } catch (error) {
    console.error('Accept offer failed:', error);
    return res.status(409).json({
      error: 'Offer could not be accepted'
    });
  }
});


app.post('/offers/:offerId/counter', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId!;
  const offerId = req.params.offerId;
  const { amount, comment } = req.body ?? {};
  const price = Number(amount);

  if (
    typeof offerId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(offerId)
  ) {
    return res.status(400).json({ error: 'Invalid offer ID' });
  }

  if (!Number.isFinite(price) || price <= 0 || price > 1000000000) {
    return res.status(400).json({ error: 'Invalid amount' });
  }

  if (comment !== undefined && comment !== null &&
      (typeof comment !== 'string' || comment.length > 1000)) {
    return res.status(400).json({ error: 'Invalid comment' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const targetResult = await client.query(
      `SELECT f.id, f.order_id, f.courier_id, f.proposer_id,
              f.status AS offer_status, o.customer_id, o.status AS order_status,
              o.courier_id AS assigned_courier_id, o.early_access_until
       FROM public.offers f
       JOIN public.orders o ON o.id = f.order_id
       JOIN public.profiles p ON p.id = $2 AND p.is_blocked = false
       WHERE f.id = $1
       FOR UPDATE OF f, o`,
      [offerId, userId]
    );

    if (targetResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Offer not found' });
    }

    const target = targetResult.rows[0];
    const isCustomer = target.customer_id === userId;
    const isCourier = target.courier_id === userId;

    if (!isCustomer && !isCourier) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Not an offer participant' });
    }

    const proposerIsExpectedParty = isCustomer
      ? target.proposer_id === target.courier_id
      : target.proposer_id === target.customer_id;

    if (!proposerIsExpectedParty) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Offer participant mismatch' });
    }

    if (target.order_status !== 'open' && target.order_status !== 'negotiating') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Order is no longer negotiating' });
    }

    if (target.assigned_courier_id !== null) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Order already has a courier' });
    }

    if (isCourier && new Date(target.early_access_until).getTime() > Date.now()) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Early access period is active' });
    }

    if (target.offer_status !== 'pending' || target.proposer_id === userId) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Offer is no longer counterable' });
    }

    const latest = await client.query(
      `SELECT 1
       FROM public.offers f
       WHERE f.id = $1
         AND NOT EXISTS (
           SELECT 1 FROM public.offers child
           WHERE child.parent_offer_id = f.id
         )`,
      [offerId]
    );

    if (latest.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Offer has already been countered' });
    }

    await client.query(
      `UPDATE public.offers SET status = 'countered' WHERE id = $1`,
      [offerId]
    );

    const created = await client.query(
      `INSERT INTO public.offers
         (order_id, courier_id, proposer_id, parent_offer_id, amount, comment)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, order_id, courier_id, proposer_id, parent_offer_id,
                 amount, comment, status, created_at`,
      [
        target.order_id,
        target.courier_id,
        userId,
        offerId,
        price,
        typeof comment === 'string' ? comment.trim() || null : null
      ]
    );

    await client.query(
      `UPDATE public.orders
       SET status = 'negotiating', updated_at = now()
       WHERE id = $1`,
      [target.order_id]
    );

    await client.query(
      `INSERT INTO public.order_events (order_id, actor_id, event_type, payload)
       VALUES ($1, $2, 'offer_countered', $3::jsonb)`,
      [
        target.order_id,
        userId,
        JSON.stringify({
          parent_offer_id: offerId,
          offer_id: created.rows[0].id,
          amount: price
        })
      ]
    );

    await client.query('COMMIT');
    return res.status(201).json({ offer: created.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Counter offer failed:', error);
    return res.status(500).json({ error: 'Could not create counter offer' });
  } finally {
    client.release();
  }
});

app.get('/me', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;

  try {
    const result = await pool.query(
      `SELECT id, username, first_name, last_name, language, created_at
       FROM public.profiles
       WHERE id = $1 AND is_blocked = false`,
      [userId]
    );

    if (result.rowCount === 0) {
      return res.status(401).json({ error: 'Profile unavailable' });
    }

    return res.json({ profile: result.rows[0] });
  } catch {
    return res.status(500).json({ error: 'Could not load profile' });
  }
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/health/db', async (_req, res) => {
  try {
    const result = await pool.query(
      'SELECT current_database() AS database, current_user AS role'
    );

    res.json({
      status: 'ok',
      database: result.rows[0].database,
      role: result.rows[0].role
    });
  } catch {
    res.status(503).json({ status: 'error', message: 'Database unavailable' });
  }
});

const server = app.listen(port, '127.0.0.1', () => {
  console.log(`Curier API listening on 127.0.0.1:${port}`);
});

async function shutdown() {
  server.close();
  await pool.end();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
