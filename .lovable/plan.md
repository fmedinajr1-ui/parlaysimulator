

# HIGH_ASSIST UNDER Implementation

## Current Status

From the 44 HIGH_ASSIST pending picks, I've identified:

### Players PLAYING Tonight (27) - Flip to UNDER

| Player | Line | L10 Rate | New Pick |
|--------|------|----------|----------|
| Amen Thompson | U5.5 | 100% | UNDER |
| Andrew Nembhard | U8.5 | 100% | UNDER |
| Anthony Black | U4.5 | 80% | UNDER |
| Brandin Podziemski | U4.5 | 80% | UNDER |
| Brandon Ingram | U3.5 | 70% | UNDER |
| Cam Spencer | U8.5 | 90% | UNDER |
| Coby White | U4.5 | 80% | UNDER |
| Davion Mitchell | U6.5 | 80% | UNDER |
| De'Aaron Fox | U5.5 | 100% | UNDER |
| Derrick White | U5.5 | 100% | UNDER |
| Donovan Mitchell | U6.5 | 90% | UNDER |
| Dyson Daniels | U5.5 | 80% | UNDER |
| Immanuel Quickley | U5.5 | 70% | UNDER |
| Jaden McDaniels | U2.5 | 70% | UNDER |
| Jalen Brunson | U5.5 | 90% | UNDER |
| Jalen Johnson | U7.5 | 100% | UNDER |
| Jalen Suggs | U4.5 | 80% | UNDER |
| Jamal Shead | U4.5 | 80% | UNDER |
| Jaylen Brown | U4.5 | 70% | UNDER |
| Josh Giddey | U7.5 | 86% | UNDER |
| Jusuf Nurkic | U5.5 | 90% | UNDER |
| Keyonte George | U6.5 | 70% | UNDER |
| LaMelo Ball | U6.5 | 90% | UNDER |
| Luka Doncic | U9.5 | 100% | UNDER |
| Matas Buzelis | U2.5 | 80% | UNDER |
| Scottie Barnes | U4.5 | 80% | UNDER |
| Stephon Castle | U6.5 | 100% | UNDER |

### Players NOT PLAYING Tonight (17) - Mark Inactive

Cade Cunningham, Cam Thomas, Darius Garland, Deni Avdija, Devin Booker, Isaiah Collier, Ja Morant, Jalen Pickett, Jamal Murray, James Harden, Jimmy Butler III, Jrue Holiday, Kevin Porter Jr., Nicolas Claxton, Shai Gilgeous-Alexander, Tre Jones, Tyrese Maxey

---

## Implementation Plan

### Step 1: Update Edge Function

Modify `category-props-analyzer/index.ts` to add `HIGH_ASSIST_UNDER` category that:
- Uses same player detection (high L10 hit rates on assists)
- Recommends UNDER instead of OVER
- Keeps confidence scoring

### Step 2: Database Updates

**SQL 1 - Flip playing players to UNDER:**
```sql
UPDATE category_sweet_spots
SET 
  recommended_side = 'under',
  category = 'HIGH_ASSIST_UNDER'
WHERE category = 'HIGH_ASSIST'
AND analysis_date = '2026-01-28'
AND outcome = 'pending'
AND player_name IN (
  'Amen Thompson', 'Andrew Nembhard', 'Anthony Black', 'Brandin Podziemski',
  'Brandon Ingram', 'Cam Spencer', 'Coby White', 'Davion Mitchell', 
  'De''Aaron Fox', 'Derrick White', 'Donovan Mitchell', 'Dyson Daniels',
  'Immanuel Quickley', 'Jaden McDaniels', 'Jalen Brunson', 'Jalen Johnson',
  'Jalen Suggs', 'Jamal Shead', 'Jaylen Brown', 'Josh Giddey', 'Jusuf Nurkic',
  'Keyonte George', 'LaMelo Ball', 'Luka Doncic', 'Matas Buzelis', 
  'Scottie Barnes', 'Stephon Castle'
);
```

**SQL 2 - Deactivate non-playing players:**
```sql
UPDATE category_sweet_spots
SET is_active = false
WHERE category = 'HIGH_ASSIST'
AND analysis_date = '2026-01-28'
AND outcome = 'pending'
AND player_name IN (
  'Cade Cunningham', 'Cam Thomas', 'Darius Garland', 'Deni Avdija',
  'Devin Booker', 'Isaiah Collier', 'Ja Morant', 'Jalen Pickett',
  'Jamal Murray', 'James Harden', 'Jimmy Butler III', 'Jrue Holiday',
  'Kevin Porter Jr.', 'Nicolas Claxton', 'Shai Gilgeous-Alexander',
  'Tre Jones', 'Tyrese Maxey'
);
```

---

## Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/category-props-analyzer/index.ts` | Add HIGH_ASSIST_UNDER category |
| Database | Flip 27 picks to UNDER, deactivate 17 non-playing |

---

## Expected Outcome

Based on historical 74% miss rate on OVERs, flipping to UNDER should yield approximately 70%+ hit rate on these 27 picks tonight.

