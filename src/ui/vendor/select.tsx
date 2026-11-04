'use client';

// Vendored from betterfanslink components/ui/select.tsx (main d4138f9): Select, on the package's color names.
import { Select as BaseSelect } from '@base-ui/react/select';
import { Check, ChevronsUpDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from './cn';
import { useFieldControl } from './field';

export type SelectItem<V extends string> = { value: V; label: ReactNode; description?: ReactNode };

export const popupClass = cn(
  'rounded-xl border border-input bg-card text-foreground shadow-lg outline-none',
  'origin-[var(--transform-origin)] transition-[transform,opacity] duration-150 ease-out',
  'data-[ending-style]:scale-[0.97] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.97] data-[starting-style]:opacity-0',
);

export const itemClass = cn(
  'flex cursor-default items-center gap-2 rounded-md px-2.5 py-2 text-sm outline-none select-none',
  'data-[highlighted]:bg-accent data-[highlighted]:text-foreground data-[disabled]:opacity-50',
);

/**
 * A single-value select. `items` drives both the list and the trigger label,
 * so the trigger always shows the chosen label, never the raw value.
 */
export function Select<V extends string>({
  value,
  onValueChange,
  items,
  placeholder,
  className,
  size = 'md',
  disabled,
  id,
  'aria-label': ariaLabel,
}: {
  value: V | null;
  onValueChange: (value: V) => void;
  items: readonly SelectItem<V>[];
  placeholder?: string;
  className?: string;
  size?: 'sm' | 'md';
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
}) {
  const field = useFieldControl(id);
  return (
    <BaseSelect.Root
      items={items.map((i) => ({ value: i.value, label: i.label }))}
      value={value}
      onValueChange={(v) => {
        if (v !== null) onValueChange(v as V);
      }}
      disabled={disabled}
    >
      <BaseSelect.Trigger
        {...field}
        aria-label={ariaLabel}
        className={cn(
          'flex min-w-0 cursor-pointer items-center justify-between gap-2 rounded-lg border border-input bg-card text-foreground',
          'outline-none hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
          'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-60',
          size === 'sm' ? 'h-8 px-2.5 text-[13px]' : 'h-9 px-3 text-sm',
          className,
        )}
      >
        <BaseSelect.Value className="truncate data-[placeholder]:text-muted-foreground/80" placeholder={placeholder} />
        <BaseSelect.Icon className="text-muted-foreground/80">
          <ChevronsUpDown className="size-3.5" aria-hidden />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner className="z-50 outline-none" sideOffset={6} alignItemWithTrigger={false}>
          <BaseSelect.Popup className={cn(popupClass, 'min-w-[var(--anchor-width)] p-1')}>
            <BaseSelect.List className="max-h-[min(22rem,var(--available-height))] overflow-y-auto">
              {items.map((item) => (
                <BaseSelect.Item key={item.value} value={item.value} className={cn(itemClass, 'pr-8')}>
                  <div className="flex min-w-0 flex-col">
                    <BaseSelect.ItemText className="truncate">{item.label}</BaseSelect.ItemText>
                    {item.description ? <span className="text-xs text-muted-foreground/80">{item.description}</span> : null}
                  </div>
                  <BaseSelect.ItemIndicator className="absolute right-2.5 text-primary">
                    <Check className="size-4" aria-hidden />
                  </BaseSelect.ItemIndicator>
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
