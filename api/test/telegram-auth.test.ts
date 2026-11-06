import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyTelegramInitData } from '../src/telegram-auth.js';

const botToken = 'test-bot-token';

function signedInitData(options: {
  authDate?: number;
  user?: unknown;
  alterHash?: boolean;
  duplicateAuthDate?: boolean;
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
  const result = params.toString();
  return options.duplicateAuthDate ? `${result}&auth_date=${params.get('auth_date')}` : result;
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

test('rejects stale, invalid and future authentication dates', () => {
  const staleDate = Math.floor(Date.now() / 1000) - 3601;
  const futureDate = Math.floor(Date.now() / 1000) + 31;
  assert.equal(verifyTelegramInitData(signedInitData({ authDate: staleDate }), botToken), null);
  assert.equal(verifyTelegramInitData(signedInitData({ authDate: 0 }), botToken), null);
  assert.equal(verifyTelegramInitData(signedInitData({ authDate: futureDate }), botToken), null);
});

test('rejects malformed user payloads and invalid optional fields', () => {
  const invalidUsers = [
    { id: -1, first_name: 'Bad' },
    { id: 123, first_name: 4 },
    { id: 123, first_name: '' },
    { id: 123, first_name: 'Good', username: 42 },
    { id: 123, first_name: 'Good', language_code: false },
    { id: 123, first_name: 'Good', last_name: 'x'.repeat(257) },
    null,
    ['not', 'an', 'object']
  ];

  for (const user of invalidUsers) {
    assert.equal(verifyTelegramInitData(signedInitData({ user }), botToken), null);
  }
});

test('rejects duplicate parameters, empty and oversized data', () => {
  assert.equal(verifyTelegramInitData('', botToken), null);
  assert.equal(verifyTelegramInitData('x'.repeat(16_385), botToken), null);
  assert.equal(verifyTelegramInitData(signedInitData({ duplicateAuthDate: true }), botToken), null);
});
