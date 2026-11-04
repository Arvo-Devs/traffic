'use client';

// Vendored from betterfanslink components/ui/field.tsx (main d4138f9): Field and useFieldControl, on the package's color names, without FieldGroup.
import { createContext, use, useId, type ReactNode } from 'react';
import { cn } from './cn';

type FieldIds = { id: string; hintId: string; errorId: string; invalid: boolean; hasHint: boolean };
const FieldContext = createContext<FieldIds | null>(null);

/** The ids and aria wiring an input inside a Field needs. */
export function useFieldControl(id?: string) {
  const ctx = use(FieldContext);
  if (!ctx) return { id };
  const describedBy = [ctx.hasHint ? ctx.hintId : null, ctx.invalid ? ctx.errorId : null].filter(Boolean).join(' ');
  return {
    id: id ?? ctx.id,
    'aria-describedby': describedBy || undefined,
    'aria-invalid': ctx.invalid || undefined,
  };
}

export function Field({
  label,
  hint,
  error,
  optional,
  className,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  optional?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const id = useId();
  const ids: FieldIds = {
    id: `${id}-control`,
    hintId: `${id}-hint`,
    errorId: `${id}-error`,
    invalid: !!error,
    hasHint: !!hint,
  };
  return (
    <FieldContext value={ids}>
      <div className={cn('flex flex-col gap-1.5', className)}>
        <label htmlFor={ids.id} className="flex items-baseline justify-between gap-2 text-[13px] font-medium text-foreground">
          <span>{label}</span>
          {optional ? <span className="text-xs font-normal text-muted-foreground/80">Optional</span> : null}
        </label>
        {children}
        {hint ? (
          <p id={ids.hintId} className="text-xs leading-relaxed text-muted-foreground/80">
            {hint}
          </p>
        ) : null}
        {error ? (
          <p id={ids.errorId} role="alert" className="text-xs leading-relaxed text-danger-strong">
            {error}
          </p>
        ) : null}
      </div>
    </FieldContext>
  );
}
