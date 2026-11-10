# Activity organisation

Entries keep one purpose/category and one activity. Optional `blocks.details`
JSONB stores `modes` (an array), `destination`, and separate `company` / `project` fields. Gym is an activity
under Exercise; its existing workout note format is preserved. Leisure, Learning,
Work & career and Life admin & chores retain their existing stable category IDs.
Personal care & health uses `health`.

`activity-model.js` is shared by the browser, voice planners, Telegram and the
history migration. Transport choices are explicit; multiple modes represent one
journey and reports count that time once. They never invent minutes per mode.
Work reports group projects independently of activity type. Existing project-only
labels become activity Work with a project; no focused-work claim is inferred. Project names live in owner-scoped synced settings, not public application code.

New entries use the activity picker, with transport controls for Travel and a
required Company selection followed by a required Project / task selection filtered to that company. Adding a company/project is explicit; switching company clears the project. Telegram accepts structured details on new items
and `activity_details` on an exact existing target. Moves and undo retain details;
conflict checks include them. Public exports and restores include details.

## Historical migration

Apply the additive `activity_details` schema migration before deploying clients
that read the new column. Existing owner RLS is unchanged. The browser's old
category migration remains version 2; this explicit migration records that as
complete so it cannot undo the new organisation.

Operator commands use the existing owner-scoped `day_telegram` database role:

```
node scripts/organize-history.cjs plan "/absolute/path/to/day-export.json" "/private/project-names.json"
node scripts/organize-history.cjs apply "/absolute/path/to/private/backup-directory"
node scripts/organize-history.cjs rollback "/absolute/path/to/private/backup-directory"
```

Planning reads fresh cloud records, verifies the supplied export belongs to the
same owner, accepts an optional private JSON list of project names, and stores full before snapshots, a change plan and readable report
under ignored `.day-voice/migrations/`. It does not import the old export.
Applying locks and version-checks affected rows and saves them in one transaction.
It verifies row count, identity, dates, times and non-settings notes before commit.
Rollback requires the exact post-migration versions and refuses to overwrite
subsequent edits. Private content is never committed or deployed.

Clear aliases are consolidated; original category/activity labels remain in
`details.original_category` / `details.original_activity`. Existing dates,
durations, notes, workout records, reflections and objectives stay intact.
Ambiguous activities and contradictory labels retain their classification and
receive `details.needs_review`. Insights → Review older entries lists contiguous
segments and opens the normal editor. Saving a reviewed entry clears its flag.

The migration writes a fresh organised export and review report next to the
supplied export. A complete raw before snapshot and before export remain in the
private backup directory. Those raw records are authoritative for rollback.

## Verification

Run JavaScript tests, Python unittests, the isolated PostgreSQL suite, the signed-in
mock browser fixture (`npm run test:agent:web`, Playwright path if needed), and the
static build. Browser checks cover multi-mode input, persistence and reload,
project entry and reports; no real messages or diary records are created by tests.

## Company → project/task work structure

Owner settings store `workCompanies: [{name, projects: []}]` and
`workHierarchyVersion: 1`. Company/project names stay private. New and edited Work
entries require a valid pair; the activity type remains separate. The rule is
checked in the browser, voice planners, Telegram planning, and again against
current settings at Telegram/voice save time. Undo can restore historical records.

Telegram can explicitly register a company with `work_company_add` and a project
under it with `work_project_add`. An existing activity uses `activity_details`
with separate company and project fields. Company ownership is never inferred
from a project name. Work reports include unassigned historical time.

To prepare a reversible update of older work entries:

```
node scripts/require-work-hierarchy.cjs "/path/to/owner-export.json" "/private/company-project-catalogue.json"
```

The catalogue is optional. Without an explicit, unambiguous mapping, older Work
entries retain all existing fields and are flagged for review. Apply or roll
back the emitted private plan with `scripts/organize-history.cjs` as above.

The Work picker labels its second level **Project / task**. A single task is a valid choice; it does not need to represent a whole project. Existing `project` data fields and saved entries remain compatible.

Applying a confirmed company/project mapping clears that entry's completed Work review flag. Missing or ambiguous ownership continues to require review.
