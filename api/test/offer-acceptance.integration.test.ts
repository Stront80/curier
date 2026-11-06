import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import pg from 'pg';

const connectionString = process.env.TEST_DATABASE_URL;
const enabled = Boolean(connectionString);
const pool = enabled ? new pg.Pool({ connectionString }) : null;
const migration = readFileSync('migrations/004_blocked_user_offer_acceptance.sql', 'utf8');
const cancellationMigration = readFileSync('migrations/005_order_cancellation.sql', 'utf8');

const customerId = '10000000-0000-4000-8000-000000000001';
const courierId = '10000000-0000-4000-8000-000000000002';
const orderId = '20000000-0000-4000-8000-000000000001';
const offerId = '30000000-0000-4000-8000-000000000001';

async function resetFixture() {
  if (!pool) throw new Error('TEST_DATABASE_URL is required');
  const dbName = await pool.query('SELECT current_database() AS name');
  assert.equal(
    dbName.rows[0].name,
    'curier_test',
    'Integration tests are allowed only against the dedicated curier_test database'
  );

  await pool.query(`
    DROP FUNCTION IF EXISTS public.accept_offer_transaction(uuid, uuid);
    DROP TABLE IF EXISTS public.order_events, public.offers, public.order_cancellation_requests, public.orders, public.profiles CASCADE;
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY,
      is_blocked boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public.orders (
      id uuid PRIMARY KEY,
      customer_id uuid NOT NULL REFERENCES public.profiles(id),
      status text NOT NULL,
      courier_id uuid REFERENCES public.profiles(id),
      agreed_price numeric,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.offers (
      id uuid PRIMARY KEY,
      order_id uuid NOT NULL REFERENCES public.orders(id),
      courier_id uuid NOT NULL REFERENCES public.profiles(id),
      proposer_id uuid NOT NULL REFERENCES public.profiles(id),
      parent_offer_id uuid REFERENCES public.offers(id),
      status text NOT NULL,
      amount numeric NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.order_events (
      id bigserial PRIMARY KEY,
      order_id uuid NOT NULL REFERENCES public.orders(id),
      actor_id uuid NOT NULL REFERENCES public.profiles(id),
      event_type text NOT NULL,
      payload jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await pool.query(migration);
  await pool.query(cancellationMigration);
  await pool.query(
    'INSERT INTO public.profiles (id, is_blocked) VALUES ($1, false), ($2, false)',
    [customerId, courierId]
  );
  await pool.query(
    "INSERT INTO public.orders (id, customer_id, status) VALUES ($1, $2, 'negotiating')",
    [orderId, customerId]
  );
  await pool.query(
    "INSERT INTO public.offers (id, order_id, courier_id, proposer_id, status, amount) VALUES ($1, $2, $3, $3, 'pending', 725)",
    [offerId, orderId, courierId]
  );
}

test('integration: active customer and courier can accept a pending offer', { skip: !enabled }, async () => {
  await resetFixture();
  try {
    const result = await pool!.query(
      'SELECT public.accept_offer_transaction($1::uuid, $2::uuid) AS result',
      [offerId, customerId]
    );
    assert.equal(result.rows[0].result.status, 'agreed');
    assert.equal(Number(result.rows[0].result.agreed_price), 725);

    const order = await pool!.query(
      'SELECT status, courier_id, agreed_price FROM public.orders WHERE id = $1',
      [orderId]
    );
    assert.equal(order.rows[0].status, 'agreed');
    assert.equal(order.rows[0].courier_id, courierId);
    assert.equal(Number(order.rows[0].agreed_price), 725);
  } finally {
    await pool!.query('DROP FUNCTION IF EXISTS public.accept_offer_transaction(uuid, uuid); DROP TABLE IF EXISTS public.order_events, public.offers, public.orders, public.profiles CASCADE');
  }
});


test('integration: rejects acceptance by a non-participant', { skip: !enabled }, async () => {
  await resetFixture();
  try {
    const outsiderId = '10000000-0000-4000-8000-000000000003';
    await pool!.query(
      'INSERT INTO public.profiles (id, is_blocked) VALUES ($1, false)',
      [outsiderId]
    );

    await assert.rejects(
      pool!.query(
        'SELECT public.accept_offer_transaction($1::uuid, $2::uuid)',
        [offerId, outsiderId]
      ),
      /Only order participants can accept offers/
    );

    const order = await pool!.query(
      'SELECT status, courier_id FROM public.orders WHERE id = $1',
      [orderId]
    );
    assert.equal(order.rows[0].status, 'negotiating');
    assert.equal(order.rows[0].courier_id, null);
  } finally {
    await pool!.query('DROP FUNCTION IF EXISTS public.accept_offer_transaction(uuid, uuid); DROP TABLE IF EXISTS public.order_events, public.offers, public.orders, public.profiles CASCADE');
  }
});

for (const blockedParty of ['customer', 'courier'] as const) {
  test(`integration: rejects acceptance when the ${blockedParty} is blocked`, { skip: !enabled }, async () => {
    await resetFixture();
    try {
      const blockedId = blockedParty === 'customer' ? customerId : courierId;
      await pool!.query('UPDATE public.profiles SET is_blocked = true WHERE id = $1', [blockedId]);

      await assert.rejects(
        pool!.query(
          'SELECT public.accept_offer_transaction($1::uuid, $2::uuid)',
          [offerId, customerId]
        ),
        /Offer participant unavailable/
      );

      const order = await pool!.query(
        'SELECT status, courier_id FROM public.orders WHERE id = $1',
        [orderId]
      );
      assert.equal(order.rows[0].status, 'negotiating');
      assert.equal(order.rows[0].courier_id, null);
    } finally {
      await pool!.query('DROP FUNCTION IF EXISTS public.accept_offer_transaction(uuid, uuid); DROP TABLE IF EXISTS public.order_events, public.offers, public.orders, public.profiles CASCADE');
    }
  });
}

test.after(async () => {
  await pool?.end();
});


test('integration: cancellation requests require a reason and allow only one pending request per order', { skip: !enabled }, async () => {
  await resetFixture();
  try {
    const requestId = '40000000-0000-4000-8000-000000000001';
    await pool!.query(
      `INSERT INTO public.order_cancellation_requests
         (id, order_id, requested_by, reason)
       VALUES ($1, $2, $3, $4)`,
      [requestId, orderId, customerId, 'Customer requested cancellation']
    );
    await assert.rejects(
      pool!.query(
        `INSERT INTO public.order_cancellation_requests
           (order_id, requested_by, reason)
         VALUES ($1, $2, $3)`,
        [orderId, courierId, 'Duplicate pending request']
      ),
      (error: unknown) => (error as { code?: string }).code === '23505'
    );
    await assert.rejects(
      pool!.query(
        `INSERT INTO public.order_cancellation_requests
           (order_id, requested_by, reason)
         VALUES ($1, $2, $3)`,
        [orderId, customerId, '   ']
      ),
      (error: unknown) => (error as { code?: string }).code === '23514'
    );
    const row = await pool!.query(
      `SELECT status, requested_by, reason, requested_at
       FROM public.order_cancellation_requests WHERE id = $1`,
      [requestId]
    );
    assert.equal(row.rows[0].status, 'pending');
    assert.equal(row.rows[0].requested_by, customerId);
    assert.equal(row.rows[0].reason, 'Customer requested cancellation');
    assert.ok(row.rows[0].requested_at instanceof Date);
  } finally {
    await pool!.query('DROP FUNCTION IF EXISTS public.accept_offer_transaction(uuid, uuid); DROP TABLE IF EXISTS public.order_events, public.offers, public.order_cancellation_requests, public.orders, public.profiles CASCADE');
  }
});

test('integration: cancellation request records the second party and confirmation timestamp', { skip: !enabled }, async () => {
  await resetFixture();
  try {
    const requestId = '40000000-0000-4000-8000-000000000002';
    await pool!.query(
      `INSERT INTO public.order_cancellation_requests
         (id, order_id, requested_by, reason)
       VALUES ($1, $2, $3, $4)`,
      [requestId, orderId, customerId, 'Delivery can no longer proceed']
    );
    await pool!.query(
      `UPDATE public.order_cancellation_requests
       SET status = 'confirmed', responded_by = $2, responded_at = now()
       WHERE id = $1`,
      [requestId, courierId]
    );
    const row = await pool!.query(
      `SELECT status, requested_by, requested_at, responded_by, responded_at
       FROM public.order_cancellation_requests WHERE id = $1`,
      [requestId]
    );
    assert.equal(row.rows[0].status, 'confirmed');
    assert.equal(row.rows[0].requested_by, customerId);
    assert.equal(row.rows[0].responded_by, courierId);
    assert.ok(row.rows[0].requested_at instanceof Date);
    assert.ok(row.rows[0].responded_at instanceof Date);
    assert.notEqual(row.rows[0].requested_by, row.rows[0].responded_by);
  } finally {
    await pool!.query('DROP FUNCTION IF EXISTS public.accept_offer_transaction(uuid, uuid); DROP TABLE IF EXISTS public.order_events, public.offers, public.order_cancellation_requests, public.orders, public.profiles CASCADE');
  }
});


test('integration: cancellation table is not public and grants API access when the role exists', { skip: !enabled }, async () => {
  await resetFixture();
  try {
    const grants = await pool!.query(
      `SELECT
         EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'curier_app') AS api_role_exists,
         CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'curier_app') THEN has_table_privilege('curier_app', 'public.order_cancellation_requests', 'SELECT') ELSE false END AS api_can_select,
         CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'curier_app') THEN has_table_privilege('curier_app', 'public.order_cancellation_requests', 'INSERT') ELSE false END AS api_can_insert,
         CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'curier_app') THEN has_table_privilege('curier_app', 'public.order_cancellation_requests', 'UPDATE') ELSE false END AS api_can_update,
         has_table_privilege('public', 'public.order_cancellation_requests', 'SELECT') AS public_can_select`
    );
    const row = grants.rows[0];
    assert.equal(row.public_can_select, false);
    if (row.api_role_exists) {
      assert.equal(row.api_can_select, true);
      assert.equal(row.api_can_insert, true);
      assert.equal(row.api_can_update, true);
    }
  } finally {
    await pool!.query('DROP FUNCTION IF EXISTS public.accept_offer_transaction(uuid, uuid); DROP TABLE IF EXISTS public.order_events, public.offers, public.order_cancellation_requests, public.orders, public.profiles CASCADE');
  }
});


test('integration: confirmed cancellation atomically cancels the order, closes active offers and writes audit history', { skip: !enabled }, async () => {
  await resetFixture();
  try {
    const requestId = '40000000-0000-4000-8000-000000000003';
    const counterOfferId = '30000000-0000-4000-8000-000000000002';
    await pool!.query(
      "UPDATE public.orders SET status = 'agreed', courier_id = $2 WHERE id = $1",
      [orderId, courierId]
    );
    await pool!.query(
      "UPDATE public.offers SET status = 'pending' WHERE id = $1",
      [offerId]
    );
    await pool!.query(
      `INSERT INTO public.offers
         (id, order_id, courier_id, proposer_id, parent_offer_id, status, amount)
       VALUES ($1, $2, $3, $3, $4, 'countered', 700)`,
      [counterOfferId, orderId, courierId, offerId]
    );
    await pool!.query(
      `INSERT INTO public.order_cancellation_requests (id, order_id, requested_by, reason)
       VALUES ($1, $2, $3, $4)`,
      [requestId, orderId, customerId, 'Package is no longer needed']
    );

    await pool!.query('BEGIN');
    try {
      const request = await pool!.query(
        `SELECT id, reason, requested_by, requested_at
         FROM public.order_cancellation_requests
         WHERE id = $1 AND order_id = $2 AND status = 'pending'
         FOR UPDATE`,
        [requestId, orderId]
      );
      assert.equal(request.rowCount, 1);
      const response = await pool!.query(
        `UPDATE public.order_cancellation_requests
         SET status = 'confirmed', responded_by = $2, responded_at = now()
         WHERE id = $1 AND status = 'pending'
         RETURNING reason, requested_by, requested_at, responded_by, responded_at`,
        [requestId, courierId]
      );
      assert.equal(response.rowCount, 1);
      await pool!.query(
        "UPDATE public.orders SET status = 'cancelled', updated_at = now() WHERE id = $1",
        [orderId]
      );
      const closed = await pool!.query(
        `UPDATE public.offers SET status = 'rejected'
         WHERE order_id = $1 AND status IN ('pending', 'countered')`,
        [orderId]
      );
      await pool!.query(
        `INSERT INTO public.order_events (order_id, actor_id, event_type, payload)
         VALUES ($1, $2, 'order_cancelled', $3::jsonb)`,
        [orderId, courierId, JSON.stringify({
          cancellation_request_id: requestId,
          reason: response.rows[0].reason,
          requested_by: response.rows[0].requested_by,
          requested_at: response.rows[0].requested_at,
          confirmed_by: courierId,
          confirmed_at: response.rows[0].responded_at,
          closed_pending_offers: closed.rowCount
        })]
      );
      await pool!.query('COMMIT');
    } catch (error) {
      await pool!.query('ROLLBACK');
      throw error;
    }

    const order = await pool!.query(
      'SELECT status FROM public.orders WHERE id = $1',
      [orderId]
    );
    assert.equal(order.rows[0].status, 'cancelled');

    const offers = await pool!.query(
      'SELECT status FROM public.offers WHERE order_id = $1 ORDER BY id',
      [orderId]
    );
    assert.equal(offers.rows.length, 2);
    assert.ok(offers.rows.every(row => row.status === 'rejected'));

    const request = await pool!.query(
      `SELECT status, reason, requested_by, requested_at, responded_by, responded_at
       FROM public.order_cancellation_requests WHERE id = $1`,
      [requestId]
    );
    assert.equal(request.rows[0].status, 'confirmed');
    assert.equal(request.rows[0].reason, 'Package is no longer needed');
    assert.equal(request.rows[0].requested_by, customerId);
    assert.equal(request.rows[0].responded_by, courierId);
    assert.ok(request.rows[0].requested_at instanceof Date);
    assert.ok(request.rows[0].responded_at instanceof Date);

    const event = await pool!.query(
      `SELECT actor_id, event_type, payload FROM public.order_events
       WHERE order_id = $1 AND event_type = 'order_cancelled'`,
      [orderId]
    );
    assert.equal(event.rows.length, 1);
    assert.equal(event.rows[0].actor_id, courierId);
    assert.equal(event.rows[0].payload.reason, 'Package is no longer needed');
    assert.equal(event.rows[0].payload.requested_by, customerId);
    assert.equal(event.rows[0].payload.confirmed_by, courierId);
    assert.equal(Number(event.rows[0].payload.closed_pending_offers), 2);
    assert.ok(event.rows[0].payload.requested_at);
    assert.ok(event.rows[0].payload.confirmed_at);
  } finally {
    await pool!.query('DROP FUNCTION IF EXISTS public.accept_offer_transaction(uuid, uuid); DROP TABLE IF EXISTS public.order_events, public.offers, public.order_cancellation_requests, public.orders, public.profiles CASCADE');
  }
});
