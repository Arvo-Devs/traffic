'use client';

// Vendored from betterfanslink components/ui/dialog.tsx (main d4138f9): Dialog, DialogContent and ConfirmDialog, on the package's color names.
import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { X } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Button, Spinner } from './button';
import { cn } from './cn';

export const Dialog = BaseDialog;

const backdropClass =
  'fixed inset-0 z-50 bg-[#06060e]/60 backdrop-blur-[2px] transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0';

/**
 * A centered dialog on wide screens and a bottom sheet under 640 px. Put a
 * Dialog.Root around it and a Dialog.Trigger next to it, or control `open`.
 */
export function DialogContent({
  title,
  description,
  children,
  footer,
  className,
  size = 'md',
}: {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <BaseDialog.Portal>
      <DialogBody title={title} description={description} footer={footer} className={className} size={size}>
        {children}
      </DialogBody>
    </BaseDialog.Portal>
  );
}

/**
 * The element that had focus when the dialog opened. Most dialogs here are
 * opened by a plain button or a menu item rather than a Dialog.Trigger, and
 * without this Base UI drops focus on the body when they close, so a keyboard
 * user starts over from the top of the page.
 */
function useReturnFocus() {
  const [opener] = useState(() => (typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null)));
  return () => (opener && opener !== document.body && opener.isConnected ? opener : true);
}

function DialogBody({
  title,
  description,
  children,
  footer,
  className,
  size,
}: {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
  size: 'sm' | 'md' | 'lg';
}) {
  const finalFocus = useReturnFocus();
  return (
    <>
      <BaseDialog.Backdrop className={backdropClass} />
      <BaseDialog.Viewport className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
        <BaseDialog.Popup
          finalFocus={finalFocus}
          className={cn(
            'flex max-h-[min(90dvh,100%)] w-full flex-col overflow-hidden border border-input bg-card text-foreground shadow-lg outline-none',
            'rounded-t-2xl sm:rounded-2xl',
            'transition-[transform,opacity] duration-200 ease-out',
            'data-[ending-style]:translate-y-4 data-[ending-style]:opacity-0 data-[starting-style]:translate-y-4 data-[starting-style]:opacity-0',
            'sm:data-[ending-style]:translate-y-0 sm:data-[ending-style]:scale-[0.97] sm:data-[starting-style]:translate-y-0 sm:data-[starting-style]:scale-[0.97]',
            size === 'sm' && 'sm:max-w-md',
            size === 'md' && 'sm:max-w-lg',
            size === 'lg' && 'sm:max-w-2xl',
            className,
          )}
        >
          <div className="flex items-start justify-between gap-4 px-5 pt-5">
            <div className="min-w-0">
              <BaseDialog.Title className="text-base font-semibold tracking-tight text-foreground">{title}</BaseDialog.Title>
              {description ? <BaseDialog.Description className="mt-1 text-sm leading-relaxed text-muted-foreground">{description}</BaseDialog.Description> : null}
            </div>
            <BaseDialog.Close
              aria-label="Close"
              className="-mt-1 -mr-1 grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg text-muted-foreground/80 outline-none hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              <X className="size-4" aria-hidden />
            </BaseDialog.Close>
          </div>
          {children ? <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-4 pb-5">{children}</div> : <div className="pb-5" />}
          {footer ? (
            <div className="flex flex-col-reverse gap-2 border-t border-border bg-background/60 px-5 py-3.5 sm:flex-row sm:justify-end">{footer}</div>
          ) : null}
        </BaseDialog.Popup>
      </BaseDialog.Viewport>
    </>
  );
}

/**
 * Confirmation for a consequential action. `consequence` is the one sentence
 * the person needs before they click.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  consequence,
  confirmLabel,
  cancelLabel = 'Cancel',
  pending,
  disabled,
  danger,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  consequence: ReactNode;
  confirmLabel: string;
  /** The dismiss button, when "Cancel" would read badly next to the action, such as "Keep link". */
  cancelLabel?: string;
  pending?: boolean;
  /** Blocks confirming without a spinner, for example until a name is typed. */
  disabled?: boolean;
  danger?: boolean;
  onConfirm: () => void;
  children?: ReactNode;
}) {
  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="sm"
        title={title}
        description={consequence}
        footer={
          <>
            <BaseDialog.Close render={<Button variant="ghost" className="max-sm:h-10" />}>{cancelLabel}</BaseDialog.Close>
            <Button variant={danger ? 'danger' : 'primary'} disabled={pending || disabled} onClick={onConfirm} className="max-sm:h-10">
              {pending ? <Spinner /> : null}
              {confirmLabel}
            </Button>
          </>
        }
      >
        {children}
      </DialogContent>
    </BaseDialog.Root>
  );
}
