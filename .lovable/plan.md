

## Make the wins file easier to browse

The Excel sheet tabs aren't clickable because Lovable's file preview only renders the first sheet — it's a viewer limitation, not a bug in the file itself. All 5 sheets are in the workbook and work fine when opened in Excel / Google Sheets / Numbers.

To unblock you immediately, I'll re-deliver the data in a format you can actually click through in the preview.

### What I'll do

Generate **two additional artifacts** alongside the existing Excel file:

**1. Five separate CSV files** (one per sheet) — `/mnt/documents/wins/`
- `01-summary.csv`
- `02-winning-parlays.csv`
- `03-parlay-legs.csv` ← the one you actually want to read
- `04-winning-straight-props.csv`
- `05-by-sport-engine.csv`

CSVs preview cleanly in Lovable's file viewer — you click each one in the sidebar instead of fighting with sheet tabs.

**2. A single HTML file** — `/mnt/documents/parlayfarm-all-wins.html`

Self-contained page with all 5 datasets as sortable, filterable tables stacked in sections with a sticky nav at the top (jump to Summary / Parlays / Legs / Straights / Breakdown). Color-coded HIT/MISS/PUSH cells, monospace odds, formatted dates and currency. Opens in any browser, including Lovable's preview.

The original `.xlsx` stays where it is for download.

### Process

1. Reload the same data already pulled (361 parlays + 1,096 legs + 230 straights)
2. Write the 5 CSVs with the same columns as the existing workbook sheets
3. Render the HTML file with embedded CSS (no external assets) and small vanilla-JS sort/filter on each table
4. Verify each file opens and renders, spot-check totals match the xlsx

### Out of scope

- Building this as an actual page inside the ParlayFarm app (different ask — let me know if you want that instead, e.g. a `/wins` route with the same data live from the DB)

