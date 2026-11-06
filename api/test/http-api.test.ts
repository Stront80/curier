import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

const connectionString = process.env.TEST_DATABASE_URL;
const enabled = Boolean(connectionString);

test('HTTP: health responds and protected routes reject missing, invalid or expired bearer tokens', {
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

    const expiredToken = jwt.sign(
      { sub: '10000000-0000-4000-8000-000000000001' },
      'http-test-secret',
      {
        issuer: 'curier-api',
        audience: 'curier-app',
        expiresIn: -1
      }
    );
    const expired = await fetch(`${baseUrl}/orders`, {
      headers: { Authorization: `Bearer ${expiredToken}` }
    });
    assert.equal(expired.status, 401);
    assert.deepEqual(await expired.json(), {
      error: 'Invalid or expired token'
    });

    const validToken = jwt.sign(
      { sub: '10000000-0000-4000-8000-000000000001' },
      'http-test-secret',
      { issuer: 'curier-api', audience: 'curier-app' }
    );
    const cancellationWithoutAuth = await fetch(
      `${baseUrl}/orders/invalid-order-id/cancellation-requests`
    );
    assert.equal(cancellationWithoutAuth.status, 401);

    const invalidCancellationOrder = await fetch(
      `${baseUrl}/orders/not-a-uuid/cancellation-requests`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${validToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ reason: 'Testing cancellation' })
      }
    );
    assert.equal(invalidCancellationOrder.status, 400);
    assert.deepEqual(await invalidCancellationOrder.json(), {
      error: 'Invalid order ID'
    });

    const invalidCancellationHistory = await fetch(
      `${baseUrl}/orders/not-a-uuid/cancellation-requests`,
      { headers: { Authorization: `Bearer ${validToken}` } }
    );
    assert.equal(invalidCancellationHistory.status, 400);
    assert.deepEqual(await invalidCancellationHistory.json(), {
      error: 'Invalid order ID'
    });

    const invalidCancellationRequestId = await fetch(
      `${baseUrl}/orders/10000000-0000-4000-8000-000000000001/cancellation-requests/not-a-uuid/confirm`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${validToken}` }
      }
    );
    assert.equal(invalidCancellationRequestId.status, 400);
    assert.deepEqual(await invalidCancellationRequestId.json(), {
      error: 'Invalid order or cancellation request ID'
    });

    const invalidCancellationDeclineRequestId = await fetch(
      `${baseUrl}/orders/10000000-0000-4000-8000-000000000001/cancellation-requests/not-a-uuid/decline`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${validToken}` }
      }
    );
    assert.equal(invalidCancellationDeclineRequestId.status, 400);
    assert.deepEqual(await invalidCancellationDeclineRequestId.json(), {
      error: 'Invalid order or cancellation request ID'
    });

    const missingCancellationReason = await fetch(
      `${baseUrl}/orders/10000000-0000-4000-8000-000000000001/cancellation-requests`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${validToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ reason: '   ' })
      }
    );
    assert.equal(missingCancellationReason.status, 400);
    assert.deepEqual(await missingCancellationReason.json(), {
      error: 'Cancellation reason is required (max 1000 characters)'
    });

    const oversizedCancellationReason = await fetch(
      `${baseUrl}/orders/10000000-0000-4000-8000-000000000001/cancellation-requests`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${validToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ reason: 'x'.repeat(1001) })
      }
    );
    assert.equal(oversizedCancellationReason.status, 400);
    assert.deepEqual(await oversizedCancellationReason.json(), {
      error: 'Cancellation reason is required (max 1000 characters)'
    });

  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

