UPDATE fanduel_prediction_accuracy 
SET was_correct = NULL, actual_outcome = NULL, verified_at = NULL, actual_value = NULL 
WHERE signal_type = 'take_it_now' 
AND created_at >= CURRENT_DATE 
AND was_correct IS NOT NULL;