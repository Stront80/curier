import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import jwt from 'jsonwebtoken';
import pg from 'pg';

const connectionString = process.env.HTTP_TEST_DATABASE_URL;
const enabled = Boolean(connectionString);
const db = enabled ? new pg.Pool({ connectionString }) : null;
const customerId = '11000000-0000-4000-8000-000000000001';
const courierId = '11000000-0000-4000-8000-000000000002';
const outsiderId = '11000000-0000-4000-8000-000000000003';
const orderId = '22000000-0000-4000-8000-000000000001';
const secondOrderId = '22000000-0000-4000-8000-000000000002';
const offerId = '33000000-0000-4000-8000-000000000001';
const counterOfferId = '33000000-0000-4000-8000-000000000002';
const migration = readFileSync('migrations/005_order_cancellation.sql', 'utf8');

async function resetFixture() {
  if (!db) throw new Error('HTTP_TEST_DATABASE_URL is required');
  const database = await db.query('SELECT current_database() AS name');
  assert.equal(
    database.rows[0].name,
    'curier_http_test',
    'HTTP tests may only reset the dedicated curier_http_test database'
  );
  await db.query(`
    DROP TABLE IF EXISTS public.order_cancellation_requests, public.order_events,
      public.offers, public.orders, public.profiles CASCADE;
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY,
      is_blocked boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public.orders (
      id uuid PRIMARY KEY,
      customer_id uuid NOT NULL REFERENCES public.profiles(id),
      status text NOT NULL,
      courier_id uuid REFERENCES public.profiles(id),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.offers (
      id uuid PRIMARY KEY,
      order_id uuid NOT NULL REFERENCES public.orders(id),
      status text NOT NULL,
      amount numeric NOT NULL DEFAULT 700
    );
    CREATE TABLE public.order_events (
      id bigserial PRIMARY KEY,
      order_id uuid NOT NULL REFERENCES public.orders(id),
      actor_id uuid REFERENCES public.profiles(id),
      event_type text NOT NULL,
      payload jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.query(migration);
  await db.query(
    'INSERT INTO public.profiles (id, is_blocked) VALUES ($1, false), ($2, false), ($3, false)',
    [customerId, courierId, outsiderId]
  );
  await db.query(
    "INSERT INTO public.orders (id, customer_id, status, courier_id) VALUES ($1, $2, 'agreed', $3), ($4, $2, 'in_transit', $3)",
    [orderId, customerId, courierId, secondOrderId]
  );
  await db.query(
    "INSERT INTO public.offers (id, order_id, status) VALUES ($1, $2, 'pending'), ($3, $2, 'countered'), ($4, $5, 'pending'), ($6, $5, 'countered')",
    [offerId, orderId, counterOfferId, '33000000-0000-4000-8000-000000000003', secondOrderId, '33000000-0000-4000-8000-000000000004']
  );
}

function token(userId: string) {
  return jwt.sign({ sub: userId }, 'cancellation-http-secret', {
    issuer: 'curier-api',
    audience: 'curier-app'
  });
}

test('HTTP integration: cancellation request, participant history, decline and confirm use the real API and isolated database', {
  skip: !enabled
}, async () => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = connectionString!;
  process.env.JWT_SECRET = 'cancellation-http-secret';
  await resetFixture();

  const { app } = await import('../src/server.js');
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const auth = (id: string) => ({ Authorization: `Bearer ${token(id)}` });

    const requested = await fetch(`${baseUrl}/orders/${orderId}/cancellation-requests`, {
      method: 'POST',
      headers: { ...auth(customerId), 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Customer cannot receive the parcel' })
    });
    assert.equal(requested.status, 201);
    const requestBody = await requested.json() as { cancellationRequest: {
      id: string; reason: string; requested_by: string; requested_at: string; status: string
    } };
    const requestId = requestBody.cancellationRequest.id;
    assert.equal(requestBody.cancellationRequest.reason, 'Customer cannot receive the parcel');
    assert.equal(requestBody.cancellationRequest.requested_by, customerId);
    assert.ok(requestBody.cancellationRequest.requested_at);
    assert.equal(requestBody.cancellationRequest.status, 'pending');

    const outsiderHistory = await fetch(
      `${baseUrl}/orders/${orderId}/cancellation-requests`,
      { headers: auth(outsiderId) }
    );
    assert.equal(outsiderHistory.status, 403);

    const courierHistory = await fetch(
      `${baseUrl}/orders/${orderId}/cancellation-requests`,
      { headers: auth(courierId) }
    );
    assert.equal(courierHistory.status, 200);
    const historyBody = await courierHistory.json() as { cancellationRequests: Array<{ id: string; reason: string }> };
    assert.equal(historyBody.cancellationRequests[0].id, requestId);
    assert.equal(historyBody.cancellationRequests[0].reason, 'Customer cannot receive the parcel');

    const selfConfirm = await fetch(
      `${baseUrl}/orders/${orderId}/cancellation-requests/${requestId}/confirm`,
      { method: 'POST', headers: auth(customerId) }
    );
    assert.equal(selfConfirm.status, 403);

    const outsiderDecline = await fetch(
      `${baseUrl}/orders/${orderId}/cancellation-requests/${requestId}/decline`,
      { method: 'POST', headers: auth(outsiderId) }
    );
    assert.equal(outsiderDecline.status, 403);

    const declined = await fetch(
      `${baseUrl}/orders/${orderId}/cancellation-requests/${requestId}/decline`,
      { method: 'POST', headers: auth(courierId) }
    );
    assert.equal(declined.status, 200);
    assert.equal((await declined.json() as { declined: boolean }).declined, true);
    const declinedState = await db!.query(
      'SELECT status, courier_id FROM public.orders WHERE id = $1',
      [orderId]
    );
    assert.equal(declinedState.rows[0].status, 'agreed');
    assert.equal(declinedState.rows[0].courier_id, courierId);
    const stillActiveOffer = await db!.query('SELECT status FROM public.offers WHERE id = $1', [offerId]);
    assert.equal(stillActiveOffer.rows[0].status, 'pending');

    const secondRequested = await fetch(
      `${baseUrl}/orders/${secondOrderId}/cancellation-requests`,
      {
        method: 'POST',
        headers: { ...auth(courierId), 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Parcel damaged after pickup' })
      }
    );
    assert.equal(secondRequested.status, 201);
    const secondRequest = await secondRequested.json() as { cancellationRequest: { id: string } };
    const confirmed = await fetch(
      `${baseUrl}/orders/${secondOrderId}/cancellation-requests/${secondRequest.cancellationRequest.id}/confirm`,
      { method: 'POST', headers: auth(customerId) }
    );
    assert.equal(confirmed.status, 200);
    const confirmedBody = await confirmed.json() as { cancelled: boolean; cancellationRequest: {
      status?: string; requested_by: string; responded_by: string; responded_at: string
    } };
    assert.equal(confirmedBody.cancelled, true);
    assert.equal(confirmedBody.cancellationRequest.requested_by, courierId);
    assert.equal(confirmedBody.cancellationRequest.responded_by, customerId);
    assert.ok(confirmedBody.cancellationRequest.responded_at);

    const finalState = await db!.query(
      'SELECT status FROM public.orders WHERE id = $1',
      [secondOrderId]
    );
    assert.equal(finalState.rows[0].status, 'cancelled');
    const closedOffers = await db!.query(
      'SELECT status FROM public.offers WHERE order_id = $1 ORDER BY id',
      [secondOrderId]
    );
    assert.deepEqual(closedOffers.rows.map(row => row.status), ['rejected', 'rejected']);
    const events = await db!.query(
      'SELECT event_type, payload FROM public.order_events WHERE order_id = $1 ORDER BY id',
      [secondOrderId]
    );
    assert.deepEqual(events.rows.map(row => row.event_type), ['cancellation_requested', 'order_cancelled']);
    assert.equal(events.rows[1].payload.reason, 'Parcel damaged after pickup');
    assert.equal(events.rows[1].payload.confirmed_by, customerId);
    assert.ok(events.rows[1].payload.confirmed_at);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
});

test.after(async () => {
  await db?.end();
});
