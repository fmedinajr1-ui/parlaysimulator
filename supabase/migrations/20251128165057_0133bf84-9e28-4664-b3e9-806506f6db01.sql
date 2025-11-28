-- Create trigger to update AI metrics when training data parlay_outcome is set
CREATE TRIGGER on_training_data_settled
  AFTER UPDATE ON parlay_training_data
  FOR EACH ROW
  WHEN (NEW.parlay_outcome IS NOT NULL AND OLD.parlay_outcome IS NULL)
  EXECUTE FUNCTION update_ai_metrics();