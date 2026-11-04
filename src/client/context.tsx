'use client';

// Where the Traffic routes are mounted, for every call the page makes. The
// default is /api/traffic; a TrafficProvider moves it for everything inside,
// and TrafficReport's basePath prop moves it for the page alone.
import { createContext, use, type ReactNode } from 'react';
import { TRAFFIC_BASE_PATH } from '../notes';

const BasePathContext = createContext<string>(TRAFFIC_BASE_PATH);

export type TrafficProviderProps = {
  /** Where the app mounted the Traffic routes. Leave it out to keep the one from an outer provider, or /api/traffic. */
  basePath?: string;
  children: ReactNode;
};

export function TrafficProvider({ basePath, children }: TrafficProviderProps) {
  const outer = use(BasePathContext);
  // No slash at the end, so the calls can add theirs: /api/traffic/links.
  const value = basePath === undefined ? outer : basePath.replace(/\/+$/, '') || TRAFFIC_BASE_PATH;
  return <BasePathContext value={value}>{children}</BasePathContext>;
}

/** The base path in effect: the nearest provider's, or /api/traffic. */
export function useTrafficBasePath(): string {
  return use(BasePathContext);
}
