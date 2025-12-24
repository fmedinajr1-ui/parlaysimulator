-- Add slip_image_url column to parlay_history
ALTER TABLE public.parlay_history 
ADD COLUMN slip_image_url TEXT DEFAULT NULL;

-- Create betting-slips storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('betting-slips', 'betting-slips', true);

-- Allow authenticated users to upload their own slips
CREATE POLICY "Users can upload own betting slips"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'betting-slips' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Allow users to view their own slips
CREATE POLICY "Users can view own betting slips"
ON storage.objects
FOR SELECT
USING (
  bucket_id = 'betting-slips' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Allow admins to view all betting slips
CREATE POLICY "Admins can view all betting slips"
ON storage.objects
FOR SELECT
USING (
  bucket_id = 'betting-slips' 
  AND has_role(auth.uid(), 'admin'::app_role)
);

-- Public read access for displaying images (since bucket is public)
CREATE POLICY "Public can view betting slips"
ON storage.objects
FOR SELECT
USING (bucket_id = 'betting-slips');