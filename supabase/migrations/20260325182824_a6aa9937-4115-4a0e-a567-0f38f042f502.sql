
-- Void all pending parlays for today that have ANY projected-only legs or missing player data
-- Keep only the 8 parlays where ALL legs have verified sportsbook lines

UPDATE bot_daily_parlays
SET outcome = 'void', lesson_learned = 'Voided: legs used projected lines, not verified sportsbook lines'
WHERE parlay_date = CURRENT_DATE
  AND outcome = 'pending'
  AND id NOT IN (
    '00fdeb4f-e11f-4352-ac4c-a6bf4fdb52f0',
    'ef363577-eeb2-48b4-9984-1d7db02fbc06',
    'e7e5f2c7-195b-4dc9-8f8e-84a5a5ed9b68',
    '62bad08f-fe17-4643-b855-e470690bb33f',
    'da18d5ee-7cae-4333-a030-694fb716f570',
    '536b209b-eff8-40f3-b11a-bfa34a1d4e33',
    'b4546e7b-fb58-452c-a36b-c2b644acd443',
    '093b73e4-bda8-45be-ae6b-2b5222f1b2fd'
  );
