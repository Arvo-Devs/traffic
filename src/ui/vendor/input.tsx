'use client';

// Vendored from betterfanslink components/ui/input.tsx (main d4138f9): Input, on the package's color names, without Textarea and SearchInput.
import type { ComponentProps } from 'react';
import { cn } from './cn';
import { useFieldControl } from './field';

export const inputClass = cn(
  'h-9 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm text-foreground',
  'placeholder:text-muted-foreground/80 transition-[border-color,box-shadow] duration-150',
  'outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/20',
  'disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-danger-strong aria-invalid:ring-danger-strong/20',
);

export function Input({ className, id, ...props }: ComponentProps<'input'>) {
  const field = useFieldControl(id);
  return <input {...field} className={cn(inputClass, className)} {...props} />;
}
