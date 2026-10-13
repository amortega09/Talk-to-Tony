# Day

A vanilla HTML/CSS/JavaScript time tracker and planner, with local browser
storage, optional Supabase sync, and a service worker for offline use.
Copy `config.example.js` to `config.js` and supply your Supabase and Google
client settings. The existing `supabase-schema.sql` defines the cloud table.
Serve the directory over HTTP; no build step is required.

## Patterns

Open **Insights → Patterns**. Analysis runs in the browser against local and
paginated Supabase records; no AI service, export, or database migration is
required. The report defaults to 30 days and also supports 7 days and all time.

- Time allocation and recorded-day coverage.
- Average longest contiguous work run and adjacent category changes.
- Average work minutes for each clock hour, with observed-day counts.
- Comparison of equal recent and preceding calendar periods, per qualifying day.
- Descriptive comparisons of target completion with exercise, energy, and logged
  overnight sleep; exercise with daily satisfaction.
- Optional 1–5 energy and satisfaction ratings below the daily timeline.

`patterns.js` calculates daily features without browser or database dependencies.
`app.js` supplies the app's existing category and objective parsers, report UI,
cloud loading, and check-in persistence. Check-ins use a `__checkin__` row in the
existing blocks table. Exports and restore include check-ins and the separate
gym logger; older exports remain accepted.

### Interpretation

A block represents 30 minutes, with no evidence of attention or task output.
Missing slots are unknown, not zero activity. Google Calendar imports are
excluded; manual plans cannot be distinguished from completed activities in the
existing model. Sleep is time recorded as sleep, without a sleep-efficiency
adjustment, and requires observed boundaries around a continuous night of at
least four hours. Sleep crossing midnight includes the preceding evening.

Comparisons exclude today, dates with holiday/travel/sick/day-off statuses, and
days with less than 16 hours of activity recorded. Each group requires at least
five days; these are exploratory descriptions, without significance tests or
causal conclusions. Transferred objectives are excluded from their original
completion denominator. Daily completion percentages weight each day equally.
The recent-period panel uses completed days; all-time compares the last two
14-day periods. Other descriptive summaries include today and partial days.

Reports prefer fresh server rows while preserving changes made during loading.
They do not overwrite local storage. Existing local-only rows remain available;
the app has no durable pending-edit queue or reliable remote deletion history.

### Validation

Run `node --test tests/patterns.test.js` and `node --check app.js`.
Tests cover incomplete logging, calendar imports, period boundaries, minimum
sample sizes, moved targets, overnight sleep, rating validation, cloud
pagination/failures, and backward-compatible restore. Browser checks use
synthetic local data. Live authenticated Supabase sync is not exercised by the
local browser checks.
