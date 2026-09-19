# Scenario matrix

All fixtures use deterministic UTC time starting `2026-01-01T00:00:00.000Z`, stable scenario IDs, and a fixed default seed. Event timestamps intentionally tie in the out-of-order cases; delivery order is listed separately.

| ID | Lifecycle check | Independent expected outcome |
| --- | --- | --- |
| `successful-checkout` | Active Pro checkout | Pro operations allowed; collaboration denied. |
| `trial-conversion` | Team trial then paid | Trial access follows configured policy; conversion preserves Team access. |
| `failed-renewal-grace` | Pro payment failure at grace boundary | Pro remains during grace; paid features deny exactly at expiry. |
| `payment-recovery` | Payment succeeds during grace | Pro access remains/restores. |
| `period-end-cancellation` | Cancel at period end | Pro until end; then only Free dashboard. |
| `immediate-cancellation` | Immediate cancellation | Paid operations deny; Free dashboard remains. |
| `upgrade-immediate` | Pro to Team | Collaboration grants at configured immediate effect. |
| `downgrade-period-end` | Team to Pro | Collaboration remains before, then denies at the exact boundary. |
| `duplicate-payment-delivery` | Same `invoice.paid` ID twice | One credit/audit effect only. |
| `out-of-order-update` | Newer Team state then stale Pro snapshot | Authoritative Team access cannot be overwritten. |
| `transient-retry` | First delivery fails transiently, then retries | Retry converges to intended Pro access; failed attempt is evidence. |
| `stale-pre-cancellation` | Cancellation then old active update | Exports/API remain denied; naive target demonstrably restores them. |

The scenario runner supports explicit provider updates, clock advances, deliveries, retry attempts, observation checkpoints, and effect assertions. Unsupported billing semantics are not fabricated: refunds preserve the current subscription state unless a policy explicitly models another effect. The scope excludes seats, usage/metered allocation, taxes, proration accounting, disputes, and multiple simultaneous subscriptions.

Observation deadline: each local operation has 2 seconds. The sample target converges synchronously when its test clock advances. A production target must set a per-scenario convergence/grace deadline; no bounded test proves all possible billing behavior.
