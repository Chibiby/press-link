# Admin dashboard — verification record

Task 23 of the 2026-08-19 admin dashboard plan. No application code is created or modified
here; this file is the only artefact. Where a check failed or could not be run, that is
recorded as such rather than smoothed over.

- **Branch:** `feat/admin-dashboard`, 27 commits ahead of `main`
- **Diff against main:** 81 files changed, 18394 insertions, 799 deletions
- **Verified at:** 2026-08-21
- **Verified by:** automated gates and diff analysis. The click-through passes in Steps 4
  and 5 are **not** performed here — see "What this record does not cover".

---

## Step 1 — the automated gates

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | **clean**, exit 0, no output |
| `npm run lint` | **clean** — exactly the 3 baseline errors, no fourth |
| `npx vitest run` | **28 files, 262 tests, 262 passed, 0 failed** |
| `npm run build` | **clean** — compiled in 6.6s, TypeScript in 11.5s, 25 static pages |

### The lint baseline

The three errors are pre-existing and unrelated to this plan:

```
app/entry/EntryWizard.tsx:96:5:react-hooks/set-state-in-effect
app/entry/SchoolPaperDialog.tsx:166:5:react-hooks/set-state-in-effect
components/theme-toggle.tsx:13:19:react-hooks/set-state-in-effect
```

One suppression exists, added by Task 3 and reviewed then:
`components/admin/shell/Sidebar.tsx:273 react-hooks/set-state-in-effect [kind=directive]`.
No new suppression was added by Tasks 15–22.

### What the build proved that nothing else could

`npm run build` had not run since Task 1. Its route table is direct structural evidence for
two claims the plan makes:

1. **The route group is not in any URL.** `(shell)` appears in no route. The four moved
   pages are listed at `/admin/entries`, `/admin/participants`, `/admin/coaches` and
   `/admin/school-papers` — their original addresses.
2. **Every new page compiles and is server-rendered on demand** (`ƒ`), which is where a page
   reading `searchParams` without awaiting it would have failed:
   `/admin/activity`, `/admin/districts`, `/admin/events`, `/admin/overall-data`,
   `/admin/overall-data/export`, `/admin/schools`, `/admin/summary`.

`/admin/login` is the one admin route built as static (`○`), consistent with it sitting
outside the shell and holding no admin query.

The build did not rewrite `AGENTS.md` — checksum `01e8142356e15c3404e0d84c48187cd0` before
and after. The working tree after the build is clean apart from `docs/guides/`, which is
deliberately untracked.

### Spec §8's eight named test files

All eight ran:

| Test file | Present |
|---|---|
| `lib/dashboard/kpis.test.ts` | yes |
| `lib/dashboard/per-school.test.ts` | yes |
| `lib/dashboard/per-event.test.ts` | yes |
| `lib/dashboard/donut.test.ts` | yes |
| `lib/dashboard/activity.test.ts` | yes |
| `lib/dashboard/timeline.test.ts` | yes |
| `lib/dashboard/attention.test.ts` | yes |
| `lib/admin/nav.test.ts` | yes |

Tasks 17–21 added five more beyond what §8 required: `overall-data-workbook`,
`registration-summary`, `school-registry`, `per-district`, `event-matrix`.

---

## Step 2 — the five edge cases spec §8 names

| # | Case | Covered | Where |
|---|---|---|---|
| 1 | Empty result set | yes | `kpis`, `donut`, `per-event`, `activity`, `timeline`, `event-matrix`, `per-district`, `overall-data-workbook` |
| 2 | Participants but zero entries | yes | `attention.test.ts`; again as the `learners-no-entry` filter in `school-registry.test.ts` |
| 3 | Event type with zero entries | yes | both behaviours, see below |
| 4 | `submitted_at` null | yes | `activity.test.ts` |
| 5 | Blank coach name | **yes — the brief was wrong** | `activity.test.ts`, `personLabel` |

### Case 3 — two correct behaviours, not one

The two panels differ on purpose and both are pinned:

- `per-event.test.ts:111` — *"returns an empty list for no rows, not a zero-filled one"*.
  A type with no entries is **excluded** from the donut; an invisible zero-width arc is
  noise in a legend.
- `event-matrix.test.ts:117` — an existing event with no entries prints `0`, an absent
  event prints an em dash. On `/admin/events` the type is **present** with a "None yet"
  badge, because that page is the catalog and a missing row would read as a missing contest.

### Case 4 — the null guard

`activity.test.ts:74` — *"never sorts a null timestamp to the top of the feed"*. The test
notes that the column is nullable, so a null reaches the merge typed as a string;
`Date.parse` yields `NaN` and the row drops out rather than sorting to the top of an
admin's feed.

### Case 5 — correcting the brief

Task 23's brief instructed that this be recorded as a **known gap with no unit test**, on
the reasoning that the plan added no name formatter and `surnameFirst()` was pre-existing.

**That is no longer true, and recording it verbatim would have put a false statement into
this record.** Task 12 added a formatter — `personLabel()` in `lib/dashboard/activity.ts` —
specifically for this case, and it is unit-tested at `activity.test.ts:124`:

```ts
expect(personLabel("")).toBe("Name not yet recorded");
expect(personLabel("   ")).toBe("Name not yet recorded");
expect(personLabel(null)).toBe("Name not yet recorded");
```

The feed routes coach names through it — `activity-source.ts:166`:

```ts
title: `Coach added — ${personLabel(surnameFirst(row))}`,
```

So the consequence the brief feared — a blank name rendering as the dangling sentence
"Coach added — " — **cannot occur**. It renders "Coach added — Name not yet recorded".
`joinMeta()` covers the same hazard on the meta line, dropping blank parts rather than
trailing a separator (`activity.test.ts:136`).

Spec §8's fifth edge case is covered. No gap to report.

---

## Step 3 — the six diff-provable safety constraints

All six hold.

| Spec §9 | Claim | Evidence | Result |
|---|---|---|---|
| 1 | No migration | `git diff main --name-only -- supabase/` prints nothing | **PASS** |
| 2 | Read-only | write-method grep over every added line, below | **PASS** |
| 3 | Lock machinery untouched | follows from 1 — those objects exist only in migrations | **PASS** |
| 4 | Action signatures unchanged | both action files are renames, sole change is an import path | **PASS** |
| 5 | `/admin/export` untouched | `app/admin/export/route.ts` and `lib/export/entries-workbook.ts` absent from the diff | **PASS** |
| 6 | Login and proxy untouched | `app/admin/login/**` and `proxy.ts` absent from the diff | **PASS** |

### §9.2 — the read-only grep, and its two false positives

```
git diff main -U0 -- "*.ts" "*.tsx" | grep "^+" \
  | grep -nE "\.(insert|update|upsert|delete)\(|\.rpc\(|\"use server\"|'use server'"
```

Two hits, **both benign**:

```
+      params.delete("district");     app/admin/(shell)/overall-data/OverallDataFilter.tsx:24
+      params.delete(key);            app/admin/(shell)/schools/SchoolRegistryFilter.tsx:29
```

Both are `URLSearchParams.prototype.delete` in client filter bars, rewriting a query string.
Neither touches the database. Narrowed greps confirm the rest:

- `.insert(`, `.upsert(`, `.rpc(`, `use server` in added lines → **no output**
- `.delete(` other than `params.delete` → **no output**

**The pathspec was checked rather than trusted.** `git diff main --name-only` lists 81 files,
78 of them `.ts`/`.tsx`; the `-- "*.ts" "*.tsx"` pathspec returns exactly those 78, and a
`comm` of the two lists is empty. No file escaped the grep, so the absence of hits is
evidence rather than an artefact of a filter.

### §9.4 — why the two action files appear in the diff at all

`git diff main --name-only` lists `app/admin/(shell)/participants/actions.ts` and
`app/admin/(shell)/school-papers/actions.ts`, which looks like a violation and is not.
`git diff main -M --name-status` resolves it: both are **renames at 95% similarity**, from
Task 5 moving the pages into the route group. The entire difference in each file is one
import line:

```diff
-import { checkAdmin } from "../guard";
+import { checkAdmin } from "@/app/admin/guard";
```

Forced by the move: `../guard` from inside `(shell)/participants/` would resolve to
`app/admin/(shell)/guard`, which does not exist. Function names, parameter types, return
types, bodies, the `admin_reset_paper_participation` / `admin_unlock_submission` RPC names
and the `revalidatePath` calls are all byte-identical. **Signatures unchanged: §9.4 holds.**

Every other moved file is `R100` — byte-identical:
`CoachFilterBar.tsx`, `ParticipantFilterBar.tsx`, `ResetPaperButton.tsx`,
`SchoolPaperFilterBar.tsx`, `UnlockSubmissionButton.tsx`.

Six of the nine constraints are satisfied by files this plan never opened. That was the
design: new code went in new files so this table could be short.

---

## Step 4 — the two constraints that need eyes

Both were checked **statically, from source**. Neither has been observed in a browser; see
"What this record does not cover".

### §9.8 — never render `events` as a flat list

Three surfaces show events. None lists 56 rows:

| Surface | Grouping | Source |
|---|---|---|
| `/admin/events` | one row per **type**, split across two cards (Individual, Group) | `buildEventMatrix` returns `individual` / `group`; the page maps each into its own `MatrixTable` |
| `/admin` donut | types, top 8 + "Other" | `summarisePerEvent(counts, { topN: DONUT_TOP_N })`, `DONUT_TOP_N = 8` |
| `/admin/overall-data` per-event table | types, all of them | `summarisePerEvent(countByEventType(rows), { topN: Number.MAX_SAFE_INTEGER })` |

`/admin/events` renders the 4 level/language slots as **columns**, not rows — which is the
structural reason 56 events occupy 16 rows. A not-offered slot prints an em dash with an
`sr-only` "Not offered at this level", never a `0`.

### §9.9 — never label a truncated list as complete

| Panel | States its cutoff | Links to |
|---|---|---|
| `/admin` Per School Summary | `PerSchoolTable:74` — "{hiddenSchools} more active schools are counted in the total" | `/admin/overall-data` ("View all N schools", Task 17) |
| `/admin` Entries by event type | `EventDonut:142` — "N of M event types have an entry" + "\"Other\" groups the N types with the fewest entries" | `/admin/overall-data` |
| `/admin` Recent activity | `ActivityFeed:83` — renders its notice when `truncated` | `/admin/activity` ("View all", Task 22) |
| `/admin/overall-data` per-school | not truncated — `limit: active.length`, `hiddenSchools: 0` | — |
| `/admin/activity` | badge reads **"Newest 50"**, and the closing paragraph repeats it when `truncated` | nothing, which is legal because the badge names the cutoff |

The last row is the one the brief said to look at hardest. `/admin/activity` is truncated and
links nowhere, so its badge is carrying the whole §9.9 obligation. It reads
`Newest ${items.length}` — never a bare "Activity Log". **Compliant.**

One addition beyond the brief: `truncated` is reported once for the page, not per day card.
A day card claiming its own day was cut would be a different and false statement — the flag
is a property of the 50-row feed, not of any one day.

### A claim this page makes about itself

`/admin/activity` closes by saying it is assembled from timestamps the database already
keeps, and that it shows when a record was created or last changed — **not who changed it,
and not what it said before**. That is accurate: there is no audit table, and Task 16's
`/admin/audit-logs` stub says the same. A screen headed "Activity Log" otherwise invites the
reading that it is an audit trail.

---

## Step 5 — the regression pass

**Not performed.** Every item in spec §8's regression list requires a running dev server and
a signed-in browser session. See below.

---

## What this record does not cover

This verification is complete for everything provable from the source, the test suite, the
production build and the diff. It is **not** complete for anything that requires a browser.

The plan forbids running `npm run dev` from an automated session — it rewrites the managed
block in `AGENTS.md` and dirties the tree — so the following are **deferred to a human
session** and remain unverified:

1. **Step 5's regression pass**, all ten items: the four moved pages loading at their
   original URLs with filters and exports intact; `/admin/export` returning a byte-identical
   workbook; `/admin/login` rendering with no shell; sign-out; theme persistence across a
   hard reload; a non-admin being redirected; and the collapsed rail across all fifteen nav
   items.
2. **Step 4 observed rather than read** — that `/admin/events` really shows 16 rows in two
   cards, and that each truncation notice is visible on screen.
3. **The cross-panel number checks** the briefs specify, which compare two independently
   computed figures against live production data:
   - `/admin/overall-data`'s per-school footer against the dashboard's footer
   - its per-event **Total** against the number in the middle of the dashboard donut
   - `/admin/schools?status=learners-no-entry` row count against the dashboard's
     "Schools with learners but no entry" badge
   - `/admin/summary`'s "N of M learners entered", where `N > M` would mean a learner from
     another school's roster is attached to this school's entry
   - the dashboard's five activity rows against the first five on `/admin/activity`
4. **Dark mode's look-at-it pass.** Task 1 validated the eight chart hues numerically;
   nobody has looked at them.
5. **The hover check on both export buttons** — that no `GET` fires on hover, which is what
   proves they are plain anchors rather than `next/link`.

Item 3 is the most valuable of these. Each pair is computed by two different routes through
the data, so a mismatch is a real bug rather than a rounding artefact, and no unit test can
catch it because both sides would have to be wrong in the same way to pass.

---

## Summary

| Area | Result |
|---|---|
| `tsc`, `lint`, `vitest`, `build` | 4 of 4 clean |
| Spec §8's eight named test files | 8 of 8 ran |
| Spec §8's five edge cases | 5 of 5 covered — one more than the brief expected |
| Spec §9's six diff-provable constraints | 6 of 6 PASS |
| Spec §9's two display constraints | 2 of 2 verified from source, not observed |
| Spec §8's regression pass | deferred to a human session |

**No check failed.** Two things were corrected rather than recorded as written:

1. Edge case 5 is **covered**, not a gap — `personLabel()` was added by Task 12 and is
   tested. The brief predated it.
2. The two `actions.ts` files in the diff are **renames with one forced import change**,
   not signature changes. §9.4 holds.

One item is parked from Task 14's review and is not a release blocker (Ruling 54):
`EventDonut:78,119` — if `active` holds a slice key no longer in `summary.slices`, every
segment dims at once. Unreachable today, because nothing re-renders the donut with a
different dataset while a slice is selected. It becomes reachable the moment a filter is
added to the dashboard donut, and it is a one-line guard.
