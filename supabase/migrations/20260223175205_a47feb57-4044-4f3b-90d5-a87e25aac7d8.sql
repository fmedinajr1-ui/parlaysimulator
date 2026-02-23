-- Make betting-slips bucket private
UPDATE storage.buckets SET public = false WHERE id = 'betting-slips';

-- Drop the overly permissive public access policy
DROP POLICY IF EXISTS "Public can view betting slips" ON storage.objects;