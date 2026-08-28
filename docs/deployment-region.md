# Why `vercel.json` pins the functions to `sin1`

`vercel.json` is JSON and cannot carry a comment, so the reasoning lives here.
If someone deletes that file or changes the region, this is what it costs.

## The topology

- **Supabase** — project `isixamkeazcjmiquanpv`, on AWS `ap-southeast-1`
  (Singapore). `db.isixamkeazcjmiquanpv.supabase.co` resolves into
  `2406:da18::/36`, which is that region's IPv6 block.
- **The admins** — Division of Sarangani, Philippines. Their requests enter
  Vercel's `sin1` edge (`X-Vercel-Id: sin1::…`).
- **The functions** — used to run in `iad1` (Washington, D.C.), which is
  Vercel's default and was never chosen.

So every admin request went Philippines → Singapore edge → **Washington** →
back to **Singapore** for each database call → Washington → Singapore edge →
Philippines. The data crossed the Pacific twice per query, in a request whose
browser and whose database were about 40 ms apart.

## What that cost

One `/admin/judges` navigation performs six *serial* network round trips before
it can finish rendering:

1. `proxy.ts` — `supabase.auth.getUser()`
2. `guard.ts` — `supabase.auth.getUser()`
3. `guard.ts` — the `admin_profiles` select
4. the event catalog
5. the batch of six judging tables (parallel with each other, one trip)
6. the entries for the events being judged (filtered by ids step 5 produces)

Measured from Sarangani, one round trip to Supabase is ~110 ms. From `iad1` it
is ~250 ms. Six of them serially is the difference between roughly 0.7 s and
roughly 1.5 s of pure latency, and the browser leg on top of it went from a
~40 ms round trip to a ~440 ms one.

In a real browser, clicking **Judges Portal** in the sidebar, eight runs each,
prefetch settled:

| | destination painted |
| --- | --- |
| `iad1` | 1997, 2029, 2199, 2467, 2504, 2539, 2889, 3303 ms — median **2504 ms** |
| `sin1` | 320, 362, 395, 408, 412, 470, 590, 797 ms — median **412 ms** |

The heaviest route moved the same way: the `/admin/entries` RSC response went
from 5.5–7.5 s to 1.5–1.6 s.

## What it does not fix

`/admin/entries` still ships a **2.4 MB** RSC payload because it renders every
entry row on the server. At Philippine consumer bandwidth that is most of its
remaining 1.5 s, and no region can help with it — that one needs pagination or
virtualisation.

## If the database ever moves

Move this with it. The rule is not "Singapore"; it is "put the functions in the
same region as Supabase, and prefer the one nearest the admins when there is a
choice". A region that is right for the database and wrong for the users still
beats one that is wrong for both.
