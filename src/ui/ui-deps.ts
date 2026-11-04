// THE design-system seam: the only place this package's client files get
// their UI primitives and UI helpers. They are self-contained copies of
// BetterFans Link's components (./vendor, each file names its source and
// commit), drawn with the shadcn color names that ../styles/tokens.css
// defines. Adapting the Traffic page to another design system means editing
// exactly this file: point these exports at your own components with the
// same names and props.

export { StatusDot } from './vendor/badge';
export { Button, Spinner } from './vendor/button';
export { Card, CardBody, CardHeader, Stat } from './vendor/card';
export { AreaChart, Breakdown } from './vendor/charts';
export { cn } from './vendor/cn';
export { COPY_FAILED, CopyButton, useCopy } from './vendor/copy';
export { ConfirmDialog, Dialog, DialogContent } from './vendor/dialog';
export { errorFromBody, TrafficError } from './vendor/errors';
export { Field } from './vendor/field';
export { formatDate, formatNumber, plural } from './vendor/format';
export { Input } from './vendor/input';
export { Segmented } from './vendor/segmented';
export { Select } from './vendor/select';
export { Skeleton } from './vendor/skeleton';
export { EmptyState, ErrorState, InlineError } from './vendor/states';
export { Table, TBody, Td, Th, THead, Tr } from './vendor/table';
export { RelativeTime } from './vendor/time';
export { pickParam, useUrlParams } from './vendor/url-state';
