# Press Link v2 — Entry Restructure & UI Redesign

Supersedes the entry-page and visual portions of
`2026-08-13-press-link-design.md`. The auth model, RLS policies, school
seeding, and admin filtering semantics from v1 are unchanged.

## 1. Why

Two problems with v1:

1. **The entry page is a wall.** School Paper forms (English + Filipino,
   ~14 inputs) sit above the entries list on one long page, so a school
   that just wants to add a contestant scrolls past a form it already
   filled in. The event picker is a single 56-option `<select>` with
   `optgroup`s — technically correct, unusable in practice.
2. **There is no design.** The app renders unstyled HTML controls. Under
   `prefers-color-scheme: dark`, `globals.css` flips the page background
   to near-black while every control stays light-styled, which is how the
   current production screenshots look.

## 2. Entry flow restructure

`/entry` becomes a **dashboard**, not a form page.

```
/entry  (dashboard)
├── header: school name · district · entry count · sign out · theme toggle
├── action bar: [+ Create Entry] [School Paper] [Export ▾]
└── entries table: Event · Level · Language · Participants · Coaches · Submitted · ⋯
```

- **School Paper** info moves into a dialog opened from the action bar.
  It is filled once per language and reused across every entry — it is
  never re-asked inside the entry wizard.
- **Create Entry** opens a **4-step wizard in a dialog**, not a page:

| Step | Choice | Source |
|---|---|---|
| 1 | Category — Individual / Group | `event_types.category` |
| 2 | Event — e.g. "News Writing / Pagsulat ng Balita" | `event_types` filtered by category |
| 3 | Level — Elementary / Secondary | levels that actually exist for that event type |
| 4 | Language — English / Filipino | languages that exist for that type+level |
| 5 | Participants + Coaches | as v1 (1 participant for individual, 2+ for group; 1–2 coaches) |

Steps 3 and 4 render only genuinely-available options. MOJO, Online
Publishing, TV Broadcasting (Regular), and TV Broadcasting (SPJ) are
Secondary-only, so choosing them collapses step 3 to Secondary alone —
the wizard auto-selects and advances rather than showing a dead choice.

Editing an existing entry reopens the same wizard prefilled, jumping
straight to step 5.

## 3. Data model change: `event_types`

v1 stored 56 flat `events` rows whose language-specific names ("News
Writing" vs "Pagsulat ng Balita") gave the wizard no way to offer a
single language-neutral event choice at step 2. v2 normalizes:

### `event_types` (new)
| column | type | notes |
|---|---|---|
| id | uuid pk default gen_random_uuid() | |
| slug | text unique not null | e.g. `news-writing` |
| category | text not null check (category in ('individual','group')) | |
| name_en | text not null | e.g. `News Writing` |
| name_fil | text not null | e.g. `Pagsulat ng Balita` |
| sort_order | int not null | |

16 rows — 10 individual, 6 group:

**Individual (10):** news-writing, editorial-writing, column-writing,
feature-writing, sci-tech-writing, editorial-cartooning, photojournalism,
sports-writing, copy-editing, mojo *(Secondary only)*.

**Group (6):** radio-broadcasting-regular, collaborative-publishing,
radio-broadcasting-spj, online-publishing *(Sec only)*,
tv-broadcasting-regular *(Sec only)*, tv-broadcasting-spj *(Sec only)*.

Group event types carry the same label in both languages (the source
sheet gives identical text for English and Filipino group events), so
`name_en` and `name_fil` are equal for all 6. MOJO is likewise `MOJO` in
both.

### `events` (modified)
Gains `event_type_id uuid not null references event_types(id)`. The
existing `category`, `level`, `language`, `name`, `sort_order` columns
stay — `category` and `name` become derivable but are kept so the admin
table and existing queries need no rewrite.

Row count stays 56. `9 individual × 2 levels × 2 langs = 36`, `+ MOJO ×
1 level × 2 langs = 2` → 38 individual. `3 group × 2 × 2 = 12`, `+ 3
group × 1 × 2 = 6` → 18 group.

### Code normalization
Six group Secondary-only rows were seeded as `{slug}-{lang}` while every
other row is `{slug}-{level}-{lang}` — e.g. `online-publishing-eng`
instead of `online-publishing-sec-eng`. v2 normalizes all 56 to
`{slug}-{elem|sec}-{eng|fil}`.

`entries` and `school_papers` are both empty in production at the time
of this change, so the migration needs no data preservation for them.

## 4. Design system

**shadcn/ui** on the existing Tailwind v4 + React 19 + Next.js 16 stack,
with a **Fresh Academic Teal** theme:

| Token | Light | Dark |
|---|---|---|
| primary | `#0D9488` teal-600 | `#2DD4BF` teal-400 |
| accent | `#F59E0B` amber-500 | `#FBBF24` amber-400 |
| background | `#FFFFFF` | `#0B1220` |
| muted surface | `#F8FAFC` | `#111A2B` |

- Geometric sans (Geist Sans, already loaded) for everything.
- `rounded-xl` cards with soft shadows, generous spacing.
- Both light and dark themes ship, driven by `next-themes` with a header
  toggle — replacing v1's bare `prefers-color-scheme` block that themed
  only the page background.

Components used: `button`, `card`, `dialog`, `input`, `label`, `select`,
`table`, `badge`, `separator`, `sonner` (toasts), `radio-group`,
`alert`, `dropdown-menu`, `skeleton`.

## 5. Pages

- **`/login`** — centered card, masthead wordmark, district → school →
  School ID. Same three-field logic, restyled.
- **`/admin/login`** — matching card, email + password.
- **`/entry`** — dashboard per §2.
- **`/admin`** — same filter semantics as v1 (district, school, event,
  category, language) rebuilt with shadcn `Select` + `Table`, plus the
  lock toggle as a styled `Button` with a confirmation `Dialog`.

## 6. Out of scope

- Changing auth, RLS, school seeding, or admin filter semantics.
- Per-school analytics or charts.
- Bulk import of entries.
- Export to Excel is specified as an **optional** final task; the core
  redesign is complete without it.
