import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

/**
 * The one button in the system.
 *
 * `type` defaults to `button` because the HTML default is `submit`, and a
 * `Button` inside a form that accidentally submits is a bug that only appears
 * once a real form exists. Every button states its intent.
 *
 * A busy button stays in the layout and stays focusable, so the row does not jump
 * and focus is not lost mid-action — it is disabled and labelled `aria-busy`,
 * because a spinner that replaces the label leaves a screen reader with nothing.
 */
export function Button({
  variant = 'secondary',
  size = 'md',
  busy = false,
  busyLabel,
  children,
  className,
  disabled,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  busy?: boolean;
  busyLabel?: string;
}): ReactNode {
  const classes = ['btn', `btn--${variant}`, size === 'sm' && 'btn--sm', className]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type={type}
      className={classes}
      disabled={disabled ?? busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy && <span className="btn__spinner" aria-hidden="true" />}
      <span>{busy && busyLabel ? busyLabel : children}</span>
    </button>
  );
}
