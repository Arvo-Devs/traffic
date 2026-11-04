// Vendored from betterfanslink components/ui/badge.tsx (main d4138f9): StatusDot only, on the package's color names.
import { cn } from './cn';

export type Tone = 'neutral' | 'brand' | 'ok' | 'warn' | 'danger';

const dots: Record<Tone, string> = {
  neutral: 'bg-muted-foreground/80',
  brand: 'bg-primary',
  ok: 'bg-success-strong',
  warn: 'bg-warning-strong',
  danger: 'bg-danger-strong',
};

/** A colored dot for status next to a name. Pair it with text. */
export function StatusDot({ tone, pulse, className }: { tone: Tone; pulse?: boolean; className?: string }) {
  return (
    <span className={cn('relative inline-flex size-2 shrink-0', className)} aria-hidden>
      {pulse ? <span className={cn('absolute inset-0 animate-ping rounded-full opacity-60', dots[tone])} /> : null}
      <span className={cn('relative size-2 rounded-full', dots[tone])} />
    </span>
  );
}
