'use client';

// The range the Traffic page shows, kept in the address as ?range= so a view
// can be shared and survives a reload. 7 days is the default and is left out
// of the address. TrafficRange goes in the app's page header; TrafficReport
// reads the same param.
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { TRAFFIC_RANGE_LABELS, TRAFFIC_RANGES, type TrafficRange as Range } from '../shared/summary';
import { pickParam, Segmented, useUrlParams } from '../ui/ui-deps';

export const DEFAULT_TRAFFIC_RANGE: Range = '7d';

const ITEMS = TRAFFIC_RANGES.map((value) => ({ value, label: TRAFFIC_RANGE_LABELS[value] }));

/** The range in the address, or 7 days when it names none we know. */
export function useTrafficRange(): Range {
  const params = useSearchParams();
  return pickParam(params?.get('range') ?? null, TRAFFIC_RANGES, DEFAULT_TRAFFIC_RANGE);
}

/** The range control for the app's page header: Today, 7 days, 30 days, 90 days. */
export function TrafficRange() {
  // Reading the address needs a Suspense boundary when the page is prerendered.
  return (
    <Suspense fallback={null}>
      <RangeControl />
    </Suspense>
  );
}

function RangeControl() {
  const { params, set } = useUrlParams();
  const range = pickParam(params.get('range'), TRAFFIC_RANGES, DEFAULT_TRAFFIC_RANGE);
  return <Segmented label="Range" value={range} onValueChange={(v) => set({ range: v === DEFAULT_TRAFFIC_RANGE ? null : v })} items={ITEMS} />;
}
