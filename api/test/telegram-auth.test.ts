import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyTelegramInitData } from '../src/telegram-auth.js';

const botToken = 'test-bot-token';

function signedInitData(options: {
  authDate?: number;
  user?: unknown;
  alterHash?: boolean;
} = {}): string {
  const params = new URLSearchParams();
  params.set('auth_date', String(options.authDate ?? Math.floor(Date.now() / 1000)));
  params.set('query_id', 'AAE-test-query');
  params.set('user', JSON.stringify(options.user ?? {
    id: 123456,
    first_name: 'Test',
    username: 'test_user'
  }));

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();
  const hash = createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  params.set('hash', options.alterHash ? '0'.repeat(64) : hash);
  return params.toString();
}

test('accepts correctly signed, recent Telegram initData', () => {
  const user = verifyTelegramInitData(signedInitData(), botToken);
  assert.equal(user?.id, 123456);
  assert.equal(user?.first_name, 'Test');
  assert.equal(user?.username, 'test_user');
});

test('rejects a modified or invalid signature', () => {
  assert.equal(verifyTelegramInitData(signedInitData({ alterHash: true }), botToken), null);
  assert.equal(verifyTelegramInitData('auth_date=1&user=%7B%7D&hash=bad', botToken), null);
});

test('rejects stale authentication data', () => {
  const staleDate = Math.floor(Date.now() / 1000) - 3601;
  assert.equal(verifyTelegramInitData(signedInitData({ authDate: staleDate }), botToken), null);
});

test('rejects malformed user payloads', () => {
  assert.equal(verifyTelegramInitData(signedInitData({ user: { id: -1, first_name: 'Bad' } }), botToken), null);
  assert.equal(verifyTelegramInitData(signedInitData({ user: { id: 123, first_name: 4 } }), botToken), null);
});

test('rejects empty, oversized and future-dated data', () => {
  assert.equal(verifyTelegramInitData('', botToken), null);
  assert.equal(verifyTelegramInitData('x'.repeat(16_385), botToken), null);
  const futureDate = Math.floor(Date.now() / 1000) + 31;
  assert.equal(verifyTelegramInitData(signedInitData({ authDate: futureDate }), botToken), null);
});
