'use client';

// The Traffic page's reads and writes, against the package's routes under the
// base path in effect (./context). Ported from BetterFans Link's
// lib/traffic/client.ts (main d4138f9). Errors come back as
// { error: { message, hint }, requestId } and are thrown as TrafficError,
// which ErrorState and InlineError show with the hint and the request id.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TrafficLinkPlatform } from '../shared/origin';
import type { TrafficLink, TrafficRange, TrafficSummary } from '../shared/summary';
import { errorFromBody, TrafficError } from '../ui/ui-deps';
import { useTrafficBasePath } from './context';

/** Every query this package keeps is under this key, then the base path. */
export const TRAFFIC_QUERY_KEY = ['arvo-traffic'] as const;

export function summaryKey(basePath: string, range: TrafficRange, timeZone: string) {
  return [...TRAFFIC_QUERY_KEY, basePath, 'summary', range, timeZone] as const;
}

type CallInit = Omit<RequestInit, 'headers'> & { headers?: Record<string, string> };

async function call<T>(url: string, init: CallInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, credentials: 'same-origin', headers: { accept: 'application/json', ...init.headers } });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new TrafficError(0, { message: 'Could not reach the site. Check your connection and try again.' }, null);
  }
  if (response.status === 204) return undefined as T;
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw errorFromBody(response.status, body);
  return body as T;
}

/** The page's numbers for one range, in the viewer's time zone. Read again every minute, and the last range's numbers stay up while a new one loads. */
export function useTrafficSummary(range: TrafficRange, timeZone: string) {
  const basePath = useTrafficBasePath();
  return useQuery<TrafficSummary, TrafficError>({
    queryKey: summaryKey(basePath, range, timeZone),
    queryFn: ({ signal }) => call(`${basePath}?range=${range}&tz=${encodeURIComponent(timeZone)}`, { signal }),
    refetchInterval: 60_000,
    placeholderData: (previous) => previous,
  });
}

export type NewTrafficLink = { name: string; platform: TrafficLinkPlatform; path: string };

export function useCreateTrafficLink(opts: { onSuccess?: (link: TrafficLink) => void } = {}) {
  const qc = useQueryClient();
  const basePath = useTrafficBasePath();
  return useMutation<TrafficLink, TrafficError, NewTrafficLink>({
    mutationFn: (input) => call(`${basePath}/links`, { method: 'POST', body: JSON.stringify(input), headers: { 'content-type': 'application/json' } }),
    onSuccess: async (link) => {
      await qc.invalidateQueries({ queryKey: [...TRAFFIC_QUERY_KEY, basePath, 'summary'] });
      opts.onSuccess?.(link);
    },
  });
}

export function useRemoveTrafficLink(opts: { onSuccess?: (name: string) => void } = {}) {
  const qc = useQueryClient();
  const basePath = useTrafficBasePath();
  return useMutation<void, TrafficError, { name: string }>({
    mutationFn: ({ name }) => call(`${basePath}/links?name=${encodeURIComponent(name)}`, { method: 'DELETE' }),
    onSuccess: async (_, { name }) => {
      await qc.invalidateQueries({ queryKey: [...TRAFFIC_QUERY_KEY, basePath, 'summary'] });
      opts.onSuccess?.(name);
    },
  });
}
