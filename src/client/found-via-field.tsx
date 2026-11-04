'use client';

// "How did you find us?" for the first screen a new account sees, never the
// sign-up form itself. Ported from BetterFans Link's
// components/app/found-via-field.tsx (main d4138f9), with the answers as a
// prop: give it the same list as the server config's foundViaAnswers. Send the
// answer with noteFoundVia once that screen is done.
import { useId } from 'react';
import { DEFAULT_FOUND_VIA_ANSWERS, FOUND_VIA_OTHER, FOUND_VIA_OTHER_MAX, type FoundViaChoice } from '../shared/found-via';
import { cn, Input } from '../ui/ui-deps';

export type FoundViaFieldProps = {
  /** The answer picked, or null until the person picks one. */
  value: string | null;
  onChange: (answer: string) => void;
  /** The words in the "Where?" box, kept only with Something else. */
  other: string;
  onOtherChange: (text: string) => void;
  disabled?: boolean;
  /** The answers, in the order shown. Default: DEFAULT_FOUND_VIA_ANSWERS. */
  answers?: readonly FoundViaChoice[];
};

/** "How did you find us?" as one row of choices, optional, with a box for the words when the answer is Something else. */
export function FoundViaField({ value, onChange, other, onOtherChange, disabled, answers = DEFAULT_FOUND_VIA_ANSWERS }: FoundViaFieldProps) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <p id={`${id}-label`} className="flex items-baseline justify-between gap-2 text-[13px] font-medium text-foreground">
        <span>How did you find us?</span>
        <span className="text-xs font-normal text-muted-foreground/80">Optional</span>
      </p>
      <div role="radiogroup" aria-labelledby={`${id}-label`} className="flex flex-wrap gap-2">
        {answers.map((answer) => (
          <label
            key={answer.value}
            className={cn(
              'inline-flex h-9 cursor-pointer items-center rounded-full border px-3 text-[13px] transition-colors max-sm:h-10',
              'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring',
              // The picked answer's words stay in foreground: primary as text is too faint on its own tint in dark themes.
              value === answer.value
                ? 'border-primary/60 bg-primary/10 font-medium text-foreground'
                : 'border-input text-muted-foreground hover:bg-accent hover:text-foreground',
              disabled && 'cursor-not-allowed opacity-60',
            )}
          >
            <input
              type="radio"
              name={`${id}-answer`}
              value={answer.value}
              checked={value === answer.value}
              disabled={disabled}
              onChange={() => onChange(answer.value)}
              className="sr-only"
            />
            {answer.label}
          </label>
        ))}
      </div>
      {value === FOUND_VIA_OTHER ? (
        <Input
          aria-label="Where did you find us?"
          placeholder="Where?"
          value={other}
          maxLength={FOUND_VIA_OTHER_MAX}
          disabled={disabled}
          onChange={(e) => onOtherChange(e.target.value)}
          className="mt-1 max-sm:h-10 max-sm:text-base"
        />
      ) : null}
    </div>
  );
}
