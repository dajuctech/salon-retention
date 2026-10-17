# Roles and Permissions

Permissions apply within a single salon. A user can belong to several salons and have a different role in each. Every check is done on the server (in `src/server/authz.ts`). Hiding a button in the UI is never enough.

| Capability | Owner | Receptionist | Barber | Platform admin |
|---|:-:|:-:|:-:|:-:|
| Edit salon settings (hours, timezone, currency, reminders, providers) | ✅ | ❌ | ❌ | support only |
| Invite or deactivate staff, change roles | ✅ | ❌ | ❌ | ❌ |
| Manage services and prices | ✅ | ❌ | ❌ | ❌ |
| Edit barber availability | ✅ all | ✅ all | ✅ own | ❌ |
| View customers | ✅ | ✅ | ✅ name, preferences, notes for own bookings only; no phone number | ❌ (only through audited support access) |
| Create or edit customers | ✅ | ✅ | ❌ | ❌ |
| Merge customers | ✅ | ✅ | ❌ | ❌ |
| Export or delete customer data | ✅ | ❌ | ❌ | ❌ |
| Create, reschedule or cancel bookings | ✅ | ✅ | ✅ own | ❌ |
| Mark booking completed or no-show | ✅ | ✅ | ✅ own | ❌ |
| Record payments | ✅ | ✅ | ✅ own bookings | ❌ |
| Record refunds or adjustments | ✅ | ❌ | ❌ | ❌ |
| View revenue and reports | ✅ | ✅ today only | ❌ | ❌ |
| View message log | ✅ | ✅ | ❌ | ❌ |
| Change a customer's consent | ✅ | ✅ (only to record a verbal request; audited) | ❌ | ❌ |
| Create or approve promotions | ✅ | ❌ | ❌ | ❌ |
| Approve, schedule or skip win-back drafts (one at a time or Approve all) | ✅ | ❌ | ❌ | ❌ |
| Read and reply in the WhatsApp inbox | ✅ | ✅ | ❌ | ❌ |
| Turn automatic messages on or off; edit templates | ✅ | ❌ | ❌ | ❌ |
| Use a loyalty reward when recording payment | ✅ | ✅ | ✅ own bookings | ❌ |
| Change loyalty settings | ✅ | ❌ | ❌ | ❌ |
| Use the AI copy assistant | ✅ | ❌ | ❌ | ❌ |
| View audit log | ✅ | ❌ | ❌ | ✅ |

Notes:
- Platform support access to a salon must be time-limited, approved by the salon owner, and audit-logged.
- Barbers can't see customer phone numbers. This reduces the risk of a departing barber taking the client list.
