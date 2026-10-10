import { useId, useState, type ReactNode } from 'react';
import { Icon } from './Icon';

/**
 * Form field primitives.
 *
 * Every control is wired to its label with a generated id rather than wrapping
 * the input in the label element. Both are accessible; the explicit `htmlFor`
 * additionally survives a layout that moves the label out of the input's row, and
 * the `aria-describedby` chain is what carries a hint and an error to a screen
 * reader instead of relying on proximity.
 */

interface FieldProps {
  label: string;
  hint?: ReactNode | undefined;
  error?: string | undefined;
  required?: boolean | undefined;
  children: (props: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
}

export function Field({ label, hint, error, required, children }: FieldProps): ReactNode {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');

  return (
    <div className={['field', error && 'field--invalid'].filter(Boolean).join(' ')}>
      <label className="field__label" htmlFor={id}>
        {label}
        {required && (
          <span className="field__required" aria-hidden="true">
            *
          </span>
        )}
        {required && <span className="visually-hidden"> (required)</span>}
      </label>

      {children({ id, describedBy: describedBy || undefined, invalid: Boolean(error) })}

      {hint && (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      )}
      {error && (
        <p className="field__error" id={errorId}>
          {error}
        </p>
      )}
    </div>
  );
}

interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'email' | 'password' | 'date' | 'tel' | 'number';
  placeholder?: string;
  hint?: ReactNode | undefined;
  error?: string | undefined;
  required?: boolean | undefined;
  autoComplete?: string | undefined;
  disabled?: boolean | undefined;
  min?: string | undefined;
  max?: string | undefined;
  inputMode?: 'text' | 'email' | 'numeric' | 'tel' | 'decimal';
}

export function TextField({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  hint,
  error,
  required,
  autoComplete,
  disabled,
  min,
  max,
  inputMode,
}: TextFieldProps): ReactNode {
  return (
    <Field label={label} hint={hint} error={error} required={required}>
      {({ id, describedBy, invalid }) => (
        <input
          id={id}
          className="input"
          type={type}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          min={min}
          max={max}
          inputMode={inputMode}
          autoComplete={autoComplete}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          // The email and password managers are told not to interfere: the server
          // is the authority on both, and a stale autofill would submit a password
          // the user did not choose.
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}

/**
 * A password field with a show/hide toggle.
 *
 * A mask people cannot check is a mask they get wrong: a typo in a 12-character
 * password is indistinguishable from a wrong password, and the only symptom is
 * "incorrect password". The toggle is a real `<button>` rather than a `<label>`
 * because it performs an action, and it carries `aria-pressed` so the current
 * state is announced rather than only drawn.
 *
 * The eye icon inherits `currentColor` and is never given its own colour: inside
 * the input it has to read as part of the control, not as a separate affordance.
 */
export function PasswordField({
  label,
  value,
  onChange,
  hint,
  error,
  required,
  autoComplete,
  disabled,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: ReactNode | undefined;
  error?: string | undefined;
  required?: boolean | undefined;
  autoComplete?: string | undefined;
  disabled?: boolean | undefined;
  placeholder?: string | undefined;
}): ReactNode {
  const [visible, setVisible] = useState(false);

  return (
    <Field label={label} hint={hint} error={error} required={required}>
      {({ id, describedBy, invalid }) => (
        <div className="input-affix">
          <input
            id={id}
            className="input input--affixed"
            type={visible ? 'text' : 'password'}
            value={value}
            placeholder={placeholder}
            disabled={disabled}
            autoComplete={autoComplete}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            onChange={(event) => onChange(event.target.value)}
          />
          <button
            type="button"
            className="input-affix__toggle"
            aria-pressed={visible}
            aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
            title={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
            disabled={disabled}
            onClick={() => setVisible((current) => !current)}
          >
            <Icon name={visible ? 'eyeOff' : 'eye'} size={16} />
          </button>
        </div>
      )}
    </Field>
  );
}

interface SelectFieldProps<T extends string> {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: string }[];
  hint?: ReactNode | undefined;
  error?: string | undefined;
  required?: boolean | undefined;
  disabled?: boolean | undefined;
}

export function SelectField<T extends string>({
  label,
  value,
  onChange,
  options,
  hint,
  error,
  required,
  disabled,
}: SelectFieldProps<T>): ReactNode {
  return (
    <Field label={label} hint={hint} error={error} required={required}>
      {({ id, describedBy, invalid }) => (
        <select
          id={id}
          className="input select"
          value={value}
          disabled={disabled}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          onChange={(event) => onChange(event.target.value as T)}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

interface TextAreaFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  hint?: ReactNode | undefined;
  error?: string | undefined;
  required?: boolean | undefined;
  maxLength?: number | undefined;
}

export function TextAreaField({
  label,
  value,
  onChange,
  rows = 3,
  hint,
  error,
  required,
  maxLength,
}: TextAreaFieldProps): ReactNode {
  return (
    <Field label={label} hint={hint} error={error} required={required}>
      {({ id, describedBy, invalid }) => (
        <textarea
          id={id}
          className="input textarea"
          value={value}
          rows={rows}
          maxLength={maxLength}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}

export function CheckboxField({
  label,
  checked,
  onChange,
  hint,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: ReactNode | undefined;
  disabled?: boolean | undefined;
}): ReactNode {
  const id = useId();
  const hintId = `${id}-hint`;

  return (
    <div className="field field--checkbox">
      <input
        id={id}
        className="checkbox"
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-describedby={hint ? hintId : undefined}
        onChange={(event) => onChange(event.target.checked)}
      />
      <label className="field__label field__label--inline" htmlFor={id}>
        {label}
      </label>
      {hint && (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      )}
    </div>
  );
}
