import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync('migrations/004_blocked_user_offer_acceptance.sql', 'utf8');

test('offer acceptance migration replaces the existing transaction function', () => {
  assert.match(
    migration,
    /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.accept_offer_transaction\s*\(\s*p_offer_id\s+uuid\s*,\s*p_customer_id\s+uuid/is
  );
});

test('offer acceptance serializes access to the offer and its order', () => {
  assert.match(migration, /FROM\s+public\.offers[\s\S]*?WHERE\s+id\s*=\s*p_offer_id\s+FOR\s+UPDATE/is);
  assert.match(migration, /FROM\s+public\.orders[\s\S]*?WHERE\s+id\s*=\s*v_offer\.order_id\s+FOR\s+UPDATE/is);
});

test('offer acceptance locks both participant profiles in stable order', () => {
  assert.match(
    migration,
    /WHERE\s+p\.id\s+IN\s*\(\s*v_order\.customer_id\s*,\s*v_offer\.courier_id\s*\)\s+ORDER\s+BY\s+p\.id\s+FOR\s+UPDATE/is
  );
});

test('offer acceptance rejects the transaction unless both participants are unblocked', () => {
  assert.match(migration, /AND\s+is_blocked\s*=\s*false/is);
  assert.match(migration, /v_active_participants\s*<>\s*2/is);
  assert.match(migration, /RAISE\s+EXCEPTION\s+'[^']*(blocked|active|participant unavailable)[^']*'/is);
});

test('offer acceptance keeps the security-definer search path constrained', () => {
  assert.match(migration, /SECURITY\s+DEFINER\s+SET\s+search_path\s*=\s*pg_catalog\s*,\s*public/is);
});

test('offer acceptance revokes execution from PUBLIC and is transaction-wrapped', () => {
  assert.match(migration, /^BEGIN;/);
  assert.match(migration, /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.accept_offer_transaction\s*\(\s*uuid\s*,\s*uuid\s*\)\s+FROM\s+PUBLIC/is);
  assert.match(migration, /COMMIT;\s*$/);
});
