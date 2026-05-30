Re-run the `daily-fade-parlay-generator` edge function now so a fresh Fade Parlay of the Day is generated using the reverted logic (no flip — `prediction` used directly as play side) and broadcast to the admin Telegram channel for verification.

Steps:
1. Invoke `daily-fade-parlay-generator` via curl.
2. Return the response (parlay id, legs, odds, telegram delivery status) so you can compare the Telegram message against the alerts.

No code changes.