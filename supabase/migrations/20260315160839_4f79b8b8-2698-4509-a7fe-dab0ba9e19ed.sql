UPDATE bot_daily_parlays 
SET outcome = 'won', settled_at = now(), legs_hit = 3, legs_missed = 0, 
    profit_loss = round(100 * (1.91 * 1.91 * 1.91 - 1), 2),
    lesson_learned = 'All 3 threes O0.5 hit. Grader missed due to stale game logs at settlement time.'
WHERE id = 'c8552ff1-0977-447b-8e00-3f4a2d92b670';

UPDATE bot_daily_parlays 
SET outcome = 'won', settled_at = now(), legs_hit = 3, legs_missed = 0, 
    profit_loss = round(250 * (1.91 * 1.91 * 1.91 - 1), 2),
    lesson_learned = 'All 3 bench unders hit comfortably. Grader missed due to stale game logs.'
WHERE id = '1ac20fc8-60dd-49c7-a563-7def725df1e2';

UPDATE bot_daily_parlays 
SET outcome = 'lost', settled_at = now(), legs_hit = 1, legs_missed = 2, 
    profit_loss = -250,
    lesson_learned = 'Wemby 12 reb (U10.5 miss), Garza 15 pts (U11.5 miss). Lopez 0 pts hit.'
WHERE id = 'f9c62174-daf1-46fe-b158-4a1549d33557'