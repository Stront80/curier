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
