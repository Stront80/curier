# Development roadmap

This is an implementation sequence, not a claim that the listed future features already exist.

## Phase 1 — Stabilize the current release

- [x] Document the actual Express/PostgreSQL deployment architecture.
- [x] Record the current negotiation and payment boundaries.
- [ ] Add repeatable API tests for authentication, order visibility, offer/counteroffer permissions and acceptance.
- [x] Make npm test execute real tests (Telegram authentication tests are running in CI).
- [ ] Review route authorization and validation, including blocked users and malformed IDs.
- [ ] Define allowed order state transitions and add cancellation rules.
- [ ] Verify backup/restore and rollback steps.
- [x] Add CI to build frontend and API and run tests on pull requests (verified successful on commit `3d8da3f`).

Exit criteria: builds and automated tests pass; critical order/offer permissions are covered; no deploy while checks fail.

## Phase 2 — Complete delivery lifecycle

- Define order states and allowed transitions.
- Implement courier assignment, pickup/delivery progress and completion where requirements are agreed.
- Add customer/courier cancellation rules, reasons and event history.
- Decide dispute and moderation workflow before implementing it.
- Add reliable notifications for offers, counteroffers, acceptance and lifecycle changes.

## Phase 3 — Courier ratings and reviews

- Permit a review only after a completed order.
- Enforce one review per order and verify the reviewer is the order's customer.
- Store rating, comment and timestamps; expose a courier's average and completed-delivery count.
- Add moderation/reporting and abuse controls.

## Phase 4 — Superuser administration

- Specify roles and permissions explicitly; do not rely on hidden UI controls.
- Add server-enforced superuser authorization and an audit trail.
- Provide controlled user lookup, role/option management and payment/subscription history.
- Add tests for both allowed and denied admin actions.

## Phase 5 — Subscriptions, donations and Telegram Stars

- Agree plan catalogue, prices, duration, applicable roles and benefits first.
- Implement server-created Stars invoices, pre-checkout validation and successful-payment processing.
- Verify payment payloads and persist Telegram charge IDs; enforce idempotency.
- Activate access only after a confirmed payment; handle expiry, renewal, revocation, failure and refund.
- Add configurable donation/payment link and QR code if still required.
- Test replayed updates and mismatched amounts/users.

## Product decisions required before Phases 2–5

- Exact order states and cancellation/refund/dispute policy.
- Rating scale, moderation and complaint process.
- Admin role scope and who may grant elevated permissions.
- Subscription names, prices, duration and role-specific benefits.
- Donation behavior and the chosen payment flow.
