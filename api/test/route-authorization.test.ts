import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/server.ts', 'utf8');

function routeBody(start: string, end: string): string {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `Route not found: ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `Route boundary not found: ${end}`);
  return source.slice(from, to);
}

test('order listing requires authentication and excludes blocked profiles', () => {
  const route = routeBody("app.get('/orders', requireAuth", "app.post('/orders'");
  assert.match(route, /requireAuth/);
  assert.match(route, /p\.is_blocked\s*=\s*false/);
  assert.match(route, /o\.early_access_until\s*<=\s*now\(\)/);
});

test('order creation validates fields and locks an unblocked profile', () => {
  const route = routeBody("app.post('/orders', requireAuth", "app.get('/orders/:orderId/offers'");
  assert.match(route, /typeof title !== 'string'/);
  assert.match(route, /typeof pickup_address !== 'string'/);
  assert.match(route, /typeof dropoff_address !== 'string'/);
  assert.match(route, /FOR UPDATE/);
  assert.match(route, /is_blocked\s*=\s*false/);
});

test('offer listing validates order IDs and restricts access to participants or own offers', () => {
  const route = routeBody("app.get('/orders/:orderId/offers', requireAuth", "app.post('/orders/:orderId/offers'");
  assert.match(route, /isUuid\(orderId\)/);
  assert.match(route, /isCustomer\s*\|\|\s*isAssignedCourier/);
  assert.match(route, /Not allowed to view offers/);
  assert.match(route, /p\.is_blocked\s*=\s*false/);
});

test('offer creation rejects own-order offers, unavailable orders and active early access', () => {
  const route = routeBody("app.post('/orders/:orderId/offers', requireAuth", "app.post('/offers/:offerId/accept'");
  assert.match(route, /isUuid\(orderId\)/);
  assert.match(route, /Customers cannot offer on their own order/);
  assert.match(route, /Order already has a courier/);
  assert.match(route, /Early access period is active/);
  assert.match(route, /You already have an active offer/);
});

test('counteroffers require authentication, a valid ID, an active profile and a participant', () => {
  const route = routeBody("app.post('/offers/:offerId/counter', requireAuth", "app.get('/me', requireAuth");
  assert.match(route, /Invalid offer ID/);
  assert.match(route, /p\.is_blocked\s*=\s*false/);
  assert.match(route, /Not an offer participant/);
  assert.match(route, /Offer is no longer counterable/);
  assert.match(route, /has already been countered/);
});

test('offer acceptance validates the ID and delegates authorization to the database transaction', () => {
  const route = routeBody("app.post('/offers/:offerId/accept', requireAuth", "app.post('/offers/:offerId/counter'");
  assert.match(route, /Invalid offer ID/);
  assert.match(route, /public\.accept_offer_transaction\(\$1::uuid, \$2::uuid\)/);
  assert.match(route, /Offer could not be accepted/);
  assert.match(route, /status\(409\)/);
});

test('profile endpoint does not return blocked profiles', () => {
  const route = routeBody("app.get('/me', requireAuth", "app.get('/health'");
  assert.match(route, /is_blocked\s*=\s*false/);
  assert.match(route, /Profile unavailable/);
});

test('authentication middleware requires a bearer token and verifies issuer and audience', () => {
  const from = source.indexOf('function requireAuth(');
  const to = source.indexOf('\nif (!databaseUrl)', from);
  assert.notEqual(from, -1);
  assert.notEqual(to, -1);
  const middleware = source.slice(from, to);
  assert.match(middleware, /startsWith\('Bearer '\)/);
  assert.match(middleware, /Authentication required/);
  assert.match(middleware, /jwt\.verify\(token, secret/);
  assert.match(middleware, /issuer:\s*'curier-api'/);
  assert.match(middleware, /audience:\s*'curier-app'/);
  assert.match(middleware, /Invalid or expired token/);
});

test('database health endpoint returns availability status and handles database errors', () => {
  const route = routeBody("app.get('/health/db'", "\napp.listen(");
  assert.match(route, /current_database\(\)/);
  assert.match(route, /current_user/);
  assert.match(route, /status:\s*'ok'/);
  assert.match(route, /status\(503\)/);
});
