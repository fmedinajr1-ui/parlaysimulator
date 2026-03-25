UPDATE bot_daily_parlays 
SET outcome = 'pending', dna_grade = NULL, lesson_learned = NULL 
WHERE parlay_date = CURRENT_DATE 
AND outcome = 'void' 
AND dna_grade = 'F';