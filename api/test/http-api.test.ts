import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

const connectionString = process.env.TEST_DATABASE_URL;
const enabled = Boolean(connectionString);

test('HTTP: health responds and protected routes reject missing or invalid bearer tokens', {
  skip: !enabled
}, async () => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = connectionString!;
  process.env.JWT_SECRET = 'http-test-secret';

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

    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok' });

    const unauthenticated = await fetch(`${baseUrl}/orders`);
    assert.equal(unauthenticated.status, 401);
    assert.deepEqual(await unauthenticated.json(), {
      error: 'Authentication required'
    });

    const invalidToken = jwt.sign(
      { sub: '10000000-0000-4000-8000-000000000001' },
      'wrong-secret',
      { issuer: 'curier-api', audience: 'curier-app' }
    );
    const unauthorized = await fetch(`${baseUrl}/orders`, {
      headers: { Authorization: `Bearer ${invalidToken}` }
    });
    assert.equal(unauthorized.status, 401);
    assert.deepEqual(await unauthorized.json(), {
      error: 'Invalid or expired token'
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

