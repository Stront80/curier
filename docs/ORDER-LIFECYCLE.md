# Order lifecycle and cancellation — proposal

**Status: draft for product approval.** This document does not change production behavior or database constraints. Existing API behavior and historical data must be checked before implementing these rules.

## Current behavior confirmed in the API

- New orders are created through `POST /orders`.
- Orders with status `open` or `negotiating` can receive offers, provided no courier is assigned.
- Creating an offer moves an `open` order to `negotiating`.
- Accepting an offer assigns the courier and records the agreed price through the database transaction.
- The API currently has no customer/courier cancellation endpoint or delivery-progress endpoint.
- Early access controls offer visibility/creation; it is not an order state.

## Proposed state model

| State | Meaning | Proposed next states |
|---|---|---|
| `open` | Published; no active negotiation required | `negotiating`, `cancelled` |
| `negotiating` | One or more offers are being exchanged | `open` (if all offers are withdrawn/closed), `assigned`, `cancelled` |
| `assigned` | An offer was accepted and a courier assigned | `picked_up`, `cancelled` (subject to approval policy) |
| `picked_up` | Courier has collected the item | `delivered`, `disputed` |
| `delivered` | Delivery completed | terminal |
| `cancelled` | Order cancelled with actor, reason and timestamp | terminal |
| `disputed` | Delivery requires support/moderation | `delivered` or `cancelled` after resolution |

The proposed `assigned`, `picked_up`, `delivered`, `cancelled` and `disputed` names are design suggestions, not a claim about the current database enum or constraints.

## Cancellation policy questions to approve

1. **Before courier assignment:** customer may cancel; courier may withdraw their own offer. Decide whether cancellation is allowed while counteroffers are pending.
2. **After assignment, before pickup:** propose allowing either party to request cancellation, but require the other party's confirmation or support intervention rather than silently cancelling.
3. **After pickup:** propose support-mediated cancellation/dispute only.
4. **Reasons:** require a reason code and optional comment; record actor, previous state, next state and timestamp in `order_events`.
5. **Negotiation cleanup:** on cancellation, all pending offers should become non-actionable; acceptance and counteroffer attempts must fail atomically.
6. **Payments/refunds:** payment processing is not implemented; do not promise automatic refunds until a payment lifecycle exists.
7. **Notifications:** notify the other party on cancellation requests, decisions and final state changes.

## Implementation gates

- Confirm the state names against the live schema and existing rows.
- Approve the cancellation policy above or amend it.
- Add a single transaction-safe state-transition mechanism with an explicit allowed-transition matrix.
- Test concurrent accept/cancel attempts, blocked participants, non-participants, duplicate requests and event history against disposable PostgreSQL.
- Back up production and prepare a tested rollback before any schema migration.
- Deploy only after CI passes and the operator explicitly approves the production change.
