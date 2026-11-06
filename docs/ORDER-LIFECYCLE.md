# Order lifecycle and cancellation

**Implementation status:** cancellation request schema, API routes and regression tests are in `api/migrations/005_order_cancellation.sql`, `api/src/server.ts` and the API test suite. This is code/CI only; it has not been deployed to production.

## Existing states and compatibility

Migration `001_initial.sql` defines the existing `order_status` enum: `open`, `negotiating`, `agreed`, `picked_up`, `in_transit`, `delivered`, `cancelled`, `expired` and `dispute`. The implementation reuses these values and does not introduce new order states.

The API can now initiate cancellation only for an order with an assigned courier in `agreed`, `picked_up` or `in_transit` state. This ensures there is a second party able to confirm. Orders in `open` or `negotiating` state without an assigned courier are deliberately not covered by mutual cancellation yet; there is no second participant to confirm.

## Agreed policy

- Either the customer or assigned courier may submit a cancellation request with a required reason (1–1000 characters).
- The other participant must confirm or decline; the requester cannot respond to their own request.
- The same policy applies before pickup (`agreed`) and after pickup (`picked_up` / `in_transit`).
- Only one pending cancellation request may exist per order. A declined request remains in history; a new request may then be created.
- Confirmation changes the order to `cancelled` and closes every `pending` or `countered` offer by marking it `rejected` in the same transaction.
- Request and response records retain initiator, reason, request timestamp, responding party and response timestamp.
- `order_events` receives `cancellation_requested`, `cancellation_declined` or `order_cancelled` audit events with the relevant identifiers and timestamps.
- Payment/refund automation is not included; Stars payments are not implemented.

## API routes

- `GET /orders/:orderId/cancellation-requests` — returns up to 100 cancellation requests, newest first; only the customer or assigned courier may view them.
- `POST /orders/:orderId/cancellation-requests` — JSON body: `{ "reason": "..." }`; starts a request.
- `POST /orders/:orderId/cancellation-requests/:requestId/confirm` — confirmation by the other participant; cancels the order and closes active offers.
- `POST /orders/:orderId/cancellation-requests/:requestId/decline` — declines the request and preserves the reason and response history.

All routes require a bearer token, validate UUIDs, lock the order and request rows in a transaction, verify participant identity and reject blocked participants on request/confirmation.

## Verification and rollout

- Source-level route authorization regression tests cover participant restrictions, required reason, active states, two-party confirmation, offer cleanup and event fields.
- PostgreSQL integration tests cover the migration's required reason, single-pending-request constraint and confirmation audit fields.
- CI must pass before the implementation is considered ready.
- Production migration and deployment are intentionally deferred until explicitly approved. Before rollout, back up production, inspect the deployed schema, apply migration 005, build and test the API, and verify routes in a controlled way.
