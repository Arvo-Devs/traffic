# @arvo/traffic

Traffic for your app's admin panel: how many people visit the public site,
where they came from, what they read, who signed up and what they said when
asked "How did you find us?". Built like
[@arvo/support-inbox](https://github.com/Arvo-Devs/support-inbox): one
package, installed in each app pinned to a commit, with its page in the
app's Admin section.

**Every app keeps its own visits in its own database.** Nothing goes to a
central server, so each app's Privacy page stays true. The package brings the
counter, the intake, the sign-up and Google Ads code, the Traffic page and the
SQL for the tables; the app gives it a database connection, who is signed in,
who has Mass Access and which pages count.

## What it does

- **Counts visits without cookies.** Each counted page sends one small note
  when it is shown and one with the seconds it was on screen when it is left.
  Nothing is saved in the browser. A browser signed in to the app is not
  stored (the team and customers are not traffic), and neither is a bot,
  except as excluded rows.
- **Names where each visit came from**: a tagged link (`?ref=` from the link
  maker, or utm tags), the referring site, or the in-app browser (Instagram,
  TikTok).
- **Files each sign-up under where that person first arrived**, from the same
  browser in the 30 days before, or the same address in the last two hours.
- **Asks "How did you find us?"** once, right after sign-up, never on the
  sign-up form. Optional for the person, and the answer sits beside the
  source.
- **Tells Google Ads which ad clicks became sign-ups**, as a file of offline
  conversions, with no Google tag and no cookie (optional).
- **The Traffic page**: visitors, views, sign-ups and join rate against the
  previous stretch, a chart, sources, the answers, pages, devices, browsers,
  countries, tagged links and the latest sign-ups.

## Installing

Pin to a **commit SHA** (tags move; the SHA is the pin):

```jsonc
// package.json
"dependencies": {
  "@arvo/traffic": "github:Arvo-Devs/traffic#<full-commit-sha>"
}
```

```ts
// next.config.ts: the package ships TypeScript source, and the app compiles it
transpilePackages: ["@arvo/traffic"],
```

Updating means reading `git diff <old-sha>..<new-sha>` in this repo, moving
the SHA, installing, and committing the lockfile. Install with a frozen
lockfile in builds.

## Requirements

- **Next.js (App Router) and React 19**, with **@tanstack/react-query v5**
  around the page (your `QueryClientProvider`). Route handlers are plain
  `(Request) => Response`.
- **Postgres, through a [postgres.js](https://github.com/porsager/postgres)
  client the package can use directly.** Give it a client nothing wraps with
  drizzle: `drizzle(sql)` changes how a shared client reads dates and JSON.
  A small pool of its own is the safe choice.
- **Tailwind CSS v4.** Add a source line so Tailwind sees the page's classes:

  ```css
  @source "../node_modules/@arvo/traffic/src";
  ```

## Theming

The page uses the same color names as @arvo/support-inbox, the shadcn way:
`background`, `foreground`, `card`, `muted`, `muted-foreground`, `border`,
`input`, `primary`, `primary-foreground`, `accent`, `ring`, the
`success`/`warning`/`danger` `-strong`, `-soft` and `-border` trios, and
`chart-1`. If your app already maps these for the Email page, map `background`,
`accent` and `chart-1` too and you're done. Otherwise import the defaults once:

```css
@import "@arvo/traffic/styles/tokens.css";
```

Adapting to another design system means editing one file, `src/ui/ui-deps.ts`.

## Setting it up

**1. The tables.** Copy `migrations/0001_traffic.sql` and
`migrations/0002_traffic_found_via.sql` into your migrations, in order. They
make `traffic_visits`, `traffic_links` and `traffic_found_via`. Never edit
them in place; a later version adds new files.

**2. One server file.** Lazy, so nothing connects at build time:

```ts
// lib/traffic.server.ts
import { createTraffic } from "@arvo/traffic";
import { COUNTED } from "@/lib/traffic-pages"; // the same object the counter gets

let cached: ReturnType<typeof createTraffic> | null = null;
export function traffic() {
  cached ??= createTraffic({
    db: siteDb,                   // () => Promise<postgres.Sql | null>; null answers 503
    signedInUser,                 // (request, { fresh }) => Promise<{ id, email, name?, createdAt?, viewedAs? } | null>
    canView: (user) => hasMassAccess(user), // who may open the page; everyone else gets 404
    hasSessionCookie,             // (request) => boolean, no network call
    counted: COUNTED,             // { pages: ["/", "/sign-up"], sections: ["/docs", ...] }
    siteHosts: ["example.com", "www.example.com"],
    siteUrl: "https://example.com",
    clientIp,                     // (request) => string | null, from a header your own proxy sets
    country,                      // optional: (request) => "US" | null
    testTag: "ex-test",
    accounts,                     // optional: (ids) => Promise<{ id, name, email }[] | null>, read live; null when it cannot look them up
  });
  return cached;
}
```

The full contract is `TrafficConfig` in `src/config.ts`.

**3. Two routes.**

```ts
// app/api/site-note/route.ts: the counter's notes
import { traffic } from "@/lib/traffic.server";
export const POST = (request: Request) => traffic().intake(request);
```

```ts
// app/api/traffic/[[...route]]/route.ts: the page, sign-ups, answers, Google Ads
import { traffic } from "@/lib/traffic.server";
export const GET = (request: Request) => traffic().routeHandlers.GET(request);
export const POST = (request: Request) => traffic().routeHandlers.POST(request);
export const DELETE = (request: Request) => traffic().routeHandlers.DELETE(request);
```

**4. The counter, in the root layout.**

```tsx
import { TrafficCounter } from "@arvo/traffic/counter";
<TrafficCounter counted={COUNTED} />
```

It imports almost nothing, because it ships on every public page.

**5. The page, called Traffic, in the Admin section** (Mass Access only), with
the app's usual top:

```tsx
import { TrafficRange, TrafficReport } from "@arvo/traffic/client";

<PageHeader title="Traffic" description="Visits to example.com: ..." actions={<TrafficRange />} />
<TrafficReport />
```

The range lives in the address (`?range=`). Gate the page the way the app
gates its other admin pages; the routes check `canView` again on every call.

**6. Sign-ups.** Every form that can make an account calls `noteSignup()`
right after it does (from `@arvo/traffic/client`). The server asks
`signedInUser` who that is and counts the account once, if it is under 30
minutes old. Or call `traffic().recordSignup({ request, user })` from your
own account code on the server, and keep `noteSignup()` as the fallback: the
second call counts nothing.

**7. "How did you find us?"** On the first screen a new account sees, show
`<FoundViaField />` and, once that screen is done, send what was picked:

```ts
import { noteFoundVia } from "@arvo/traffic/notes";
import { FOUND_VIA_OTHER, FOUND_VIA_SKIPPED } from "@arvo/traffic/found-via";

noteFoundVia({ answer: picked ?? FOUND_VIA_SKIPPED, other: picked === FOUND_VIA_OTHER ? words : null });
```

A blank answer is kept as skipped, so the page tells a skip from a person
never asked. Give your own answers to both the field and `foundViaAnswers` in
the config, or leave both out for the default list.

**8. Google Ads (optional).** Pass `googleAds: { user, password }` (a
password of 20 characters or more) and give Google Ads the address
`https://<site>/api/traffic/google-ads.csv` with that login for a scheduled
upload of conversions from clicks. Without it, the route does not exist.

## Routes

| Route | Who | What |
|---|---|---|
| `POST /api/site-note` | Anyone, from the site's own pages | One view or leave note. 204 and no body. |
| `GET /api/traffic?range=&tz=` | `canView` | The page's numbers (`TrafficSummary`). |
| `POST /api/traffic/links`, `DELETE /api/traffic/links?name=` | `canView`, from the site's own pages | Make or remove a tagged link. |
| `POST /api/traffic/signup` | Signed in, from the site's own pages | Count the account just made. |
| `POST /api/traffic/found-via` | Signed in, from the site's own pages | Keep the answer, once per account. |
| `GET /api/traffic/google-ads.csv` | Google Ads, with the login (HTTP Basic) | Sign-ups from Google ads in the last 90 days. |

Errors come as `{ error: { type, code, message, hint?, param? }, requestId }`,
and every answer is `no-store`.

## Privacy

- No cookie and nothing in the browser's storage.
- The visitor's address, user agent, visitor key (a hash of those two) and ad
  click ids are cleared after 180 days. The rest of the row stays, so old
  totals still add up.
- A sign-up row keeps no address, user agent or visitor key (a check in the
  table holds it). Names and emails are never stored: the page reads them
  live through `accounts`, so a deleted account shows as removed.
- Google Ads gets a click id and a time, nothing else.

## Retention and health

The intake clears old rows about once an hour, a batch at a time until none
are left. An app with a job runner can also call `traffic().clearOldVisits()`
on a schedule. `traffic().health()` answers `down` when a row two days past
the 180 still holds an address (or there is no database), and `quiet` when no
counted view arrived in 72 hours; show it
where your app shows its other checks, never in the load balancer's health
check.

## Development

```sh
bun install
bun run typecheck
bun test
```

The database tests run when `TRAFFIC_TEST_PG_URL` points at a Postgres they
may create databases on, and skip otherwise. CI runs them on every push.
