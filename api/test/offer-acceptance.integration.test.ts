import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import pg from 'pg';

const connectionString = process.env.TEST_DATABASE_URL;
const enabled = Boolean(connectionString);
const pool = enabled ? new pg.Pool({ connectionString }) : null;
const migration = readFileSync(
  new URL('../migrations/004_blocked_user_offer_acceptance.sql', import.meta.url),
  'utf8'
);

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
    DROP TABLE IF EXISTS public.order_events, public.offers, public.orders, public.profiles CASCADE;
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
