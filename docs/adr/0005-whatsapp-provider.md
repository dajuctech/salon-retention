# ADR-0005: WhatsApp provider interface, Meta Cloud API first

- Status: Accepted
- Date: 2026-10-16

## Context
WhatsApp only allows free-form messages within 24 hours of the customer's last message. Any message the business starts must use a template that Meta has approved. Templates are categorised as utility, marketing or authentication, and Meta charges per message based on category and country. Both Meta Cloud API and Twilio give access to WhatsApp.

## Decision
- Define a `MessagingProvider` interface in `src/server/messaging/provider.ts`, covering: sending a template, sending free-form text (only valid within the 24-hour window), verifying an inbound webhook, and reading delivery status.
- **Meta Cloud API** is the first adapter: no markup on Meta's pricing, and direct template management.
- The **Twilio** adapter is a fallback (for example, where Twilio's onboarding is easier).
- Each salon chooses one of two setups:
  - **Shared platform number** (R1 default): faster onboarding. Messages show our business name plus the salon name in the text.
  - **Salon's own number** (R2): onboarded through WhatsApp Embedded Signup.
- Webhook signatures are verified (`X-Hub-Signature-256` for Meta, `X-Twilio-Signature` for Twilio) before any processing.
- Templates are version-controlled in [whatsapp-templates.md](../whatsapp-templates.md) and mirrored in the `MessageTemplate` table with their approval status.

## Alternatives considered
- **Twilio only.** Simpler API, but adds a markup on every message.
- **SMS as the main channel.** Higher cost per message in many markets, and lower engagement. Kept as an R2 fallback for numbers that aren't on WhatsApp.

## Consequences
- AI can't write free-form outbound messages. It can only help write templates or promotion text, which go through approval (see [ai-design.md](../ai-design.md)).
- Template approval takes time and must be done in R0.
- Messaging cost must be shown to owners before they send a promotion (BR-PR3).
