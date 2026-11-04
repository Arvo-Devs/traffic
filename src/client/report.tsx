'use client';

// The Traffic page's body: how many people visit the site, where they came
// from, what they read, who signed up and what they said when asked "How did
// you find us?". Ported from BetterFans Link's Traffic page
// (app/(app)/dashboard/traffic/page.tsx, main d4138f9), everything inside its
// PageBody except the app's own header and gate. The app puts this under its
// own page header, with TrafficRange in the header's actions, and gates the
// page the way it gates its other admin pages; the routes check again.
import { Suspense, useMemo, useState, type ReactNode } from 'react';
import { ChartNoAxesCombined, Link2 } from 'lucide-react';
import { TRAFFIC_ADDRESS_RETENTION_DAYS } from '../paths';
import { bucketLabel, countryName, formatSeconds, pageLabel, viewerTimeZone } from '../shared/format';
import { DIRECT_SOURCE } from '../shared/origin';
import { joinRate, percentChange, type TrafficRange, type TrafficSummary } from '../shared/summary';
import {
  AreaChart,
  Breakdown,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  formatNumber,
  plural,
  RelativeTime,
  Skeleton,
  Stat,
  StatusDot,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '../ui/ui-deps';
import { useTrafficSummary } from './api';
import { TrafficProvider } from './context';
import { LinksCard, MakeLinkDialog } from './links';
import { useTrafficRange } from './range';

type Summary = TrafficSummary;

const TOP = 8;

/** The stretch each range is compared with: the same length, one range earlier, up to the same time. */
const PREVIOUS_WORDS: Record<TrafficRange, string> = {
  today: 'yesterday by this time',
  '7d': 'the 7 days before',
  '30d': 'the 30 days before',
  '90d': 'the 90 days before',
};

const RANGE_WORDS: Record<TrafficRange, string> = {
  today: 'today',
  '7d': 'the last 7 days',
  '30d': 'the last 30 days',
  '90d': 'the last 90 days',
};

const DEVICE_LABELS: Record<string, string> = { phone: 'Phone', computer: 'Computer', tablet: 'Tablet' };

/** Axis labels: whole numbers as counts, halves with one decimal. */
const axis = (v: number) => (Number.isInteger(v) ? formatNumber(v) : v.toFixed(1));

/** A page of the site at its public address, which may be another host than the dashboard's. */
const pageHref = (siteUrl: string, path: string) => `${siteUrl.replace(/\/+$/, '')}${path}`;

export type TrafficReportProps = {
  /** Where the app mounted the Traffic routes. Default: the nearest TrafficProvider's, or /api/traffic. */
  basePath?: string;
};

/** The Traffic page's body, for the range in the address (?range=, 7 days by default). */
export function TrafficReport({ basePath }: TrafficReportProps = {}) {
  return (
    <TrafficProvider basePath={basePath}>
      {/* Reading the address needs a Suspense boundary when the page is prerendered. */}
      <Suspense fallback={<TrafficSkeleton />}>
        <Report />
      </Suspense>
    </TrafficProvider>
  );
}

/** What the page shows while its numbers load, for the app's own gate to show too. */
export function TrafficSkeleton() {
  return (
    <div className="flex flex-col gap-5" role="status" aria-label="Loading">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[98px] rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-xl" />
      <div className="grid gap-5 md:grid-cols-2">
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    </div>
  );
}

function Report() {
  const range = useTrafficRange();
  const timeZone = useMemo(viewerTimeZone, []);
  const summary = useTrafficSummary(range, timeZone);
  // Each Make a link opens a new dialog, so it starts empty and never shows the last one's error.
  const [maker, setMaker] = useState({ open: false, attempt: 0 });
  const openMaker = () => setMaker((m) => ({ open: true, attempt: m.attempt + 1 }));

  const data = summary.data;
  if (summary.isPending) return <TrafficSkeleton />;
  if (!data) {
    return summary.isError ? (
      <Card>
        <ErrorState error={summary.error} onRetry={() => void summary.refetch()} retrying={summary.isFetching} />
      </Card>
    ) : null;
  }

  const quiet = data.totals.views === 0 && data.totals.signups === 0;
  return (
    <div className="flex flex-col gap-5">
      {quiet ? (
        <Card>
          <EmptyState
            icon={ChartNoAxesCombined}
            title={`No visits ${data.range === 'today' ? 'yet today' : `in ${RANGE_WORDS[data.range]}`}`}
            action={
              <Button size="sm" variant="primary" onClick={openMaker}>
                <Link2 aria-hidden />
                Make a tagged link
              </Button>
            }
          >
            Each page of the site counts itself when someone opens it. Share a tagged link in a post to see visits from that post, even from apps that
            hide where a click came from.
          </EmptyState>
        </Card>
      ) : (
        <ReportBody data={data} />
      )}
      <LinksCard links={data.links} site={data.site} onMake={openMaker} rangeWords={RANGE_WORDS[data.range]} />
      {quiet ? null : <SignupsCard signups={data.latestSignups} />}
      <HowThisCounts testTag={data.site.testTag} />
      <MakeLinkDialog key={maker.attempt} open={maker.open} onOpenChange={(open) => setMaker((m) => ({ ...m, open }))} site={data.site} />
    </div>
  );
}

function ReportBody({ data }: { data: Summary }) {
  const { totals, previous } = data;
  const previousWords = PREVIOUS_WORDS[data.range];
  const change = (current: number, before: number) => percentChange(current, before);
  // Without a change to show, say why rather than leaving the number bare.
  const sub = (current: number, before: number) => (change(current, before) !== null ? `vs ${previousWords}` : `None ${previousWords}`);
  const previousRate = joinRate(previous.signups, previous.visitors);
  const hourly = data.bucket === 'hour';
  const points = data.series.map((b) => ({ label: bucketLabel(b.bucket, data.bucket), value: b.visitors }));

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Visitors" value={formatNumber(totals.visitors)} change={change(totals.visitors, previous.visitors)} sub={sub(totals.visitors, previous.visitors)} />
        <Stat label="Page views" value={formatNumber(totals.views)} change={change(totals.views, previous.views)} sub={sub(totals.views, previous.views)} />
        <Stat label="Sign-ups" value={formatNumber(totals.signups)} change={change(totals.signups, previous.signups)} sub={sub(totals.signups, previous.signups)} />
        <Stat
          label="Join rate"
          value={totals.joinRate === null ? 'None yet' : `${totals.joinRate}%`}
          sub={previousRate === null ? 'Sign-ups for every 100 visitors' : `${previousRate}% ${previousWords}`}
        />
      </div>

      <Card>
        <CardHeader
          title={hourly ? 'Visitors by hour' : 'Visitors by day'}
          description={`In your time zone, ${data.timeZone}.`}
          action={
            <span className="inline-flex items-center gap-2 text-[13px] text-muted-foreground tabular-nums" aria-live="polite">
              <StatusDot tone={data.liveVisitors > 0 ? 'ok' : 'neutral'} pulse={data.liveVisitors > 0} />
              {data.liveVisitors > 0 ? `${plural(data.liveVisitors, 'person', 'people')} on the site now` : 'Nobody on the site right now'}
            </span>
          }
        />
        <CardBody>
          <AreaChart
            label={hourly ? 'Visitors by hour' : 'Visitors by day'}
            height={200}
            points={points}
            format={axis}
            detail={(i) => {
              const b = data.series[i];
              if (!b) return null;
              return (
                <>
                  <p className="tabular-nums">{plural(b.views, 'page view')}</p>
                  <p className="tabular-nums">{plural(b.signups, 'sign-up')}</p>
                </>
              );
            }}
          />
        </CardBody>
      </Card>

      <div className="grid gap-5 md:grid-cols-2">
        <BreakdownCard
          whole={data.totals.visitors}
          title="Where they came from"
          description="Sign-ups count under where that person first came from."
          empty="Every visit was a click inside the site."
          items={data.sources.map((s) => ({
            key: s.source,
            value: s.visitors,
            label: (
              <>
                {s.source}
                {s.signups > 0 ? <span className="ml-2 text-xs text-success-strong">{plural(s.signups, 'sign-up')}</span> : null}
              </>
            ),
          }))}
        />
        <BreakdownCard
          whole={data.foundVia.reduce((sum, f) => sum + f.signups, 0)}
          title="What sign-ups told us"
          description={'Their answer to "How did you find us?" right after signing up.'}
          empty="No answers yet. Each new account is asked once, right after signing up."
          items={data.foundVia.map((f) => ({ key: f.answer, value: f.signups, label: f.label || f.answer }))}
        />
      </div>

      <PagesCard pages={data.pages} siteUrl={data.site.url} />

      <div className="grid gap-5 md:grid-cols-3">
        <BreakdownCard
          whole={data.totals.visitors}
          title="Devices"
          empty="No devices yet."
          items={data.devices.map((d) => ({ key: d.device ?? 'unknown', value: d.visitors, label: d.device ? (DEVICE_LABELS[d.device] ?? d.device) : 'Unknown' }))}
        />
        <BreakdownCard
          whole={data.totals.visitors}
          title="Browsers"
          empty="No browsers yet."
          items={data.browsers.map((b) => ({ key: b.browser ?? 'unknown', value: b.visitors, label: b.browser ?? 'Unknown' }))}
        />
        <BreakdownCard
          whole={data.totals.visitors}
          title="Countries"
          empty="No countries yet."
          items={data.countries.map((c) => ({ key: c.country ?? 'unknown', value: c.visitors, label: countryName(c.country) }))}
        />
      </div>
    </>
  );
}

export function BreakdownCard({
  title,
  description,
  items,
  whole,
  empty,
}: {
  title: string;
  description?: string;
  /** Every row, biggest first. The card shows the top ones. */
  items: { key: string; value: number; label: ReactNode }[];
  /** What each share is of. The server sends only the top rows of a long list, so their sum falls short. */
  whole: number;
  empty: string;
}) {
  const shown = items.slice(0, TOP);
  return (
    <Card>
      <CardHeader title={title} description={items.length > TOP ? `${description ? `${description} ` : ''}Top ${TOP} of ${formatNumber(items.length)}.` : description} />
      <CardBody>
        {shown.length ? <Breakdown items={shown} whole={whole} format={formatNumber} /> : <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>}
      </CardBody>
    </Card>
  );
}

function PagesCard({ pages, siteUrl }: { pages: Summary['pages']; siteUrl: string }) {
  return (
    <Card>
      <CardHeader title="Pages" description="Average time counts only while the page was on screen." />
      {pages.length ? (
        <Table label="Pages">
          <THead>
            <Th>Page</Th>
            <Th align="right">Visitors</Th>
            <Th align="right">Views</Th>
            <Th align="right">Avg time</Th>
          </THead>
          <TBody>
            {pages.slice(0, 12).map((p) => (
              <Tr key={p.path}>
                <Td className="max-w-0 w-full">
                  <a href={pageHref(siteUrl, p.path)} target="_blank" rel="noreferrer" className="block truncate text-foreground hover:underline" title={p.path}>
                    {pageLabel(p.path)}
                  </a>
                </Td>
                <Td align="right" className="tabular-nums">
                  {formatNumber(p.visitors)}
                </Td>
                <Td align="right" className="tabular-nums text-muted-foreground">
                  {formatNumber(p.views)}
                </Td>
                <Td align="right" className="tabular-nums text-muted-foreground">
                  {formatSeconds(p.avgSeconds) ?? <span className="text-muted-foreground/80">Not measured</span>}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      ) : (
        <CardBody>
          <p className="py-6 text-center text-sm text-muted-foreground">No page views in this range.</p>
        </CardBody>
      )}
    </Card>
  );
}

function SignupsCard({ signups }: { signups: Summary['latestSignups'] }) {
  return (
    <Card>
      <CardHeader title="Latest sign-ups" description="New accounts, where each person first came from and what they told us." />
      {signups.length ? (
        <Table label="Latest sign-ups">
          <THead>
            <Th>Person</Th>
            <Th>Came from</Th>
            <Th>They said</Th>
            <Th>First page</Th>
            <Th>First visit</Th>
            <Th>Country</Th>
            <Th align="right">Signed up</Th>
          </THead>
          <TBody>
            {signups.map((s, i) => (
              <Tr key={`${s.at}-${i}`}>
                <Td className="max-w-[16rem]">
                  {s.removed ? (
                    <p className="truncate font-medium text-muted-foreground">Account removed</p>
                  ) : (
                    <>
                      <p className="truncate font-medium text-foreground">{s.name || s.email || 'Unknown'}</p>
                      {s.name && s.email ? <p className="truncate text-xs text-muted-foreground/80">{s.email}</p> : null}
                    </>
                  )}
                </Td>
                <Td className="text-muted-foreground">
                  <p className="truncate">{s.source ?? DIRECT_SOURCE}</p>
                  {s.campaign ? <p className="truncate text-xs text-muted-foreground/80">{s.campaign}</p> : null}
                </Td>
                <Td className="max-w-[14rem] text-muted-foreground">
                  {s.foundVia ? <p className="truncate">{s.foundViaLabel || s.foundVia}</p> : <span className="text-muted-foreground/80">Not asked</span>}
                  {s.foundViaOther ? (
                    <p className="truncate text-xs text-muted-foreground/80" title={s.foundViaOther}>
                      {s.foundViaOther}
                    </p>
                  ) : null}
                </Td>
                <Td className="text-muted-foreground">{s.landingPath ? pageLabel(s.landingPath) : <span className="text-muted-foreground/80">Not seen</span>}</Td>
                <Td className="whitespace-nowrap text-muted-foreground">
                  <RelativeTime iso={s.firstSeenAt} fallback="Not seen" />
                  {s.viewsBefore ? <span className="text-muted-foreground/80 tabular-nums"> · {plural(s.viewsBefore, 'page')}</span> : null}
                </Td>
                <Td className="whitespace-nowrap text-muted-foreground">{countryName(s.country)}</Td>
                <Td align="right" className="text-muted-foreground">
                  <RelativeTime iso={s.at} />
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      ) : (
        <CardBody>
          <p className="py-6 text-center text-sm text-muted-foreground">No sign-ups yet. New accounts show here with where they came from.</p>
        </CardBody>
      )}
    </Card>
  );
}

/** How the numbers are counted, under everything else, so nobody reads them as more than they are. */
function HowThisCounts({ testTag }: { testTag: string }) {
  return (
    <p className="px-1 text-xs leading-relaxed text-muted-foreground">
      <span className="font-medium text-foreground">How this counts:</span>
      {` No cookies, and nothing is kept in the visitor's browser. People who are signed in, and bots, are left out. IP addresses are cleared after ${TRAFFIC_ADDRESS_RETENTION_DAYS} days.`}
      {testTag ? (
        <>
          {' Visits with a tag starting with '}
          <span className="font-mono">{testTag}</span>
          {' are tests of the counter and are not counted.'}
        </>
      ) : null}
    </p>
  );
}
