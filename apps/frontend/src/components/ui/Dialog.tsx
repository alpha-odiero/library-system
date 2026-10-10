import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface DialogProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Widens the dialog for a data table. */
  size?: 'sm' | 'md' | 'lg';
}

/**
 * A modal dialog.
 *
 * Built on `<dialog>` rather than a div with a z-index, because the native element
 * brings the things that are easy to forget and expensive to get wrong:
 *
 *   • **Focus containment.** Tab cannot leave an open modal, which is the single
 *     most common keyboard bug in hand-rolled dialogs.
 *   • **Focus restoration.** Closing returns focus to the trigger, so a keyboard
 *     user is not dropped at the top of the document.
 *   • **Escape to close** and `inert` on the background, so a screen reader cannot
 *     wander into the page behind.
 *
 * Focus is moved to the first field on open, because a modal that opens with focus
 * still on the trigger behind it is unusable without a mouse.
 */
export function Dialog({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  size = 'md',
}: DialogProps): ReactNode {
  const ref = useRef<HTMLDialogElement>(null);
  // `useId`, not a random string: the id has to be stable across re-renders so the
  // title does not end up pointing at a label that no longer exists.
  const titleId = useId();

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    if (open && !element.open) {
      element.showModal();
      // The first focusable control, or the dialog itself if the body is a message.
      const focusable = element.querySelector<HTMLElement>(
        'input, select, textarea, button:not([disabled])',
      );
      (focusable ?? element).focus();
    } else if (!open && element.open) {
      element.close();
    }
  }, [open]);

  if (!open) return null;

  return createPortal(
    <dialog
      ref={ref}
      className={`dialog dialog--${size}`}
      aria-labelledby={titleId}
      // `onCancel` is Escape. Without it the dialog closes and React state still
      // believes it is open, so the next render tries to focus a closed element.
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // A click on the backdrop lands on the dialog element itself; a click
        // inside the panel lands on a child.
        if (event.target === ref.current) onClose();
      }}
    >
      <div className="dialog__panel">
        <header className="dialog__header">
          <h2 className="dialog__title" id={titleId}>
            {title}
          </h2>
          <button
            type="button"
            className="dialog__close"
            onClick={onClose}
            aria-label="Close dialog"
          >
            ×
          </button>
        </header>

        {description && <p className="dialog__description">{description}</p>}

        <div className="dialog__body">{children}</div>

        {footer && <footer className="dialog__footer">{footer}</footer>}
      </div>
    </dialog>,
    document.body,
  );
}

/**
 * A destructive-action confirmation.
 *
 * Separate from `Dialog` because it has one job and must never be improvised: it
 * states the consequence in the body, and the confirm button says what will
 * happen rather than "OK".
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}): ReactNode {
  return (
    <Dialog
      open={open}
      title={title}
      onClose={onCancel}
      size="sm"
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--danger"
            onClick={onConfirm}
            disabled={busy}
            aria-busy={busy || undefined}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </>
      }
    >
      <p className="dialog__message">{message}</p>
    </Dialog>
  );
}
