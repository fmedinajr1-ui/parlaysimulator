

## Fix: Make Betting Slips Storage Bucket Private

The `betting-slips` bucket is currently public with a broad "anyone can view" RLS policy, exposing user betting slip images (stakes, odds, etc.) to unauthenticated access.

### What's changing

1. **Make the bucket private** -- a new migration will set `public = false` and drop the overly permissive "Public can view betting slips" policy. The user-scoped and admin-scoped SELECT policies remain intact.

2. **Switch from public URLs to signed URLs** -- in `Upload.tsx`, replace `getPublicUrl()` with `createSignedUrl()` (1-hour expiry). This ensures only authenticated users get temporary access.

3. **Update SlipImageViewer for signed URLs** -- in `Admin.tsx`, when loading parlays with `slip_image_url`, generate a signed URL on the fly since the stored path will no longer resolve publicly. Add a small helper or inline logic to create signed URLs before passing to `SlipImageViewer`.

### Technical Details

**Migration SQL (new file)**
```sql
-- Make betting-slips bucket private
UPDATE storage.buckets SET public = false WHERE id = 'betting-slips';

-- Drop the overly permissive public access policy
DROP POLICY IF EXISTS "Public can view betting slips" ON storage.objects;
```

**File: `src/pages/Upload.tsx`**
- Replace `getPublicUrl(uploadData.path)` with `createSignedUrl(uploadData.path, 3600)` (1-hour signed URL)
- Update destructuring to handle the signed URL response format

**File: `src/pages/Admin.tsx`**
- After fetching parlays, generate signed URLs for any `slip_image_url` values using `supabase.storage.from('betting-slips').createSignedUrl(path, 3600)`
- Extract the storage path from the stored URL before generating the signed URL

**File: `src/components/admin/SlipImageViewer.tsx`**
- No changes needed -- it already accepts a URL string

**File: `src/pages/Results.tsx`**
- The slip URL passed via navigation state will already be a signed URL from Upload.tsx, so no changes needed here

