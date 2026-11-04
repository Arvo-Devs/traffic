// The client entry of @arvo/traffic: the Traffic page's body, its range
// control and skeleton, "How did you find us?" and the notes a screen sends.
// Mount the page inside the app's own QueryClientProvider. The calls go to
// /api/traffic unless TrafficReport's basePath prop or a TrafficProvider says
// otherwise. Sign-up forms can import the notes alone from
// @arvo/traffic/notes, which brings no React with it.

export { TrafficProvider } from './client/context';
export type { TrafficProviderProps } from './client/context';
export { FoundViaField } from './client/found-via-field';
export type { FoundViaFieldProps } from './client/found-via-field';
export { TrafficRange } from './client/range';
export { TrafficReport, TrafficSkeleton } from './client/report';
export type { TrafficReportProps } from './client/report';
export { noteFoundVia, noteSignup } from './notes';
export { DEFAULT_FOUND_VIA_ANSWERS, FOUND_VIA_OTHER, FOUND_VIA_OTHER_MAX, FOUND_VIA_SKIPPED } from './shared/found-via';
export type { FoundViaChoice, FoundViaNote } from './shared/found-via';
