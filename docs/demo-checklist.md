# Demo Checklist

Use this before any hotel, ryokan, or pharmacy demo.

## Environment

- Create Cloudflare D1 database `lingualive-b2b-usage`.
- Apply `migrations/0001_b2b_usage.sql` to that database.
- Bind it to Pages Functions as `DB` (Dashboard → Pages → Settings → Functions → D1 bindings).
- Do not commit the placeholder `00000000-0000-0000-0000-000000000000` database_id.
- Run `npm run demo:check`.
- Confirm demo Free or Lite account exists.
- Confirm Free is not publicly self-servable.

## Usage Gate

- Start a translation session before requesting a realtime token.
- Confirm `/api/realtime-token` requires `sessionId`.
- Confirm a suspended account cannot start a new session.
- Confirm monthly, daily, concurrent, and max-session limits are enforced.
- Confirm 45% cost ratio blocks only new starts/tokens, not an active session heartbeat.
- Confirm stale sessions older than 90 seconds no longer block concurrent capacity.
- Confirm a new session is rejected when fewer than 60 seconds are available.

## Privacy

- Confirm heartbeat/end reject transcript, translation, text, message, audio, media, and file payloads.
- Confirm usage records contain metadata only: time, account, user, duration, model, estimated cost, stop reason.
- Confirm the admin dashboard says conversation text, translation text, audio, and transcriptions are not stored.
- Confirm pharmacy accounts are fixed to metadata-only history.

## Admin Demo

- Show monthly actual usage separately from reserved seconds.
- Show daily usage separately from monthly usage.
- Show added quota minutes if present.
- Show remaining startable minutes.
- Show estimated API cost and cost ratio.
- Demonstrate account suspend/resume.

## Required Sales Language

- AI translation can be wrong.
- It is not a substitute for medical, medication, legal, or emergency judgment.
- Important details must be confirmed by staff.
- Pharmacy demos must not use real patient personal or medication information.
- The beta does not include automatic overage billing, SLA, or 24-hour emergency support.

## Do Not Demo Yet

- Public Free signup.
- Automatic overage purchase.
- Monthly CSV as a finished feature.
- Customer-admin dashboards.
- Dedicated device sales.
