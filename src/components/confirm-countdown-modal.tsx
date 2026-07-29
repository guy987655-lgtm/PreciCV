"use client";

import { ReactNode, useEffect, useState } from "react";
import { Button, Modal, Spinner } from "@/components/ui";

/**
 * Destructive confirmation whose confirm button stays disabled for a few
 * seconds. The delay is the point: these actions cannot be undone, so a
 * misdirected click on a dialog that appeared under the cursor has to be
 * impossible rather than merely unlikely.
 *
 * Built on the same Modal + danger Button as the rest of the app so it reads
 * as the existing confirmation pattern, not a new kind of dialog.
 */
export function ConfirmCountdownModal({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = "Cancel",
  seconds = 5,
  busy = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** How long the confirm button stays disabled. */
  seconds?: number;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      {/* The body is a separate component so it MOUNTS with the dialog: the
          countdown resets through useState's initializer rather than an effect,
          so a dialog dismissed and reopened can never arrive already armed. */}
      <CountdownBody
        confirmLabel={confirmLabel}
        cancelLabel={cancelLabel}
        seconds={seconds}
        busy={busy}
        onConfirm={onConfirm}
        onClose={onClose}
      >
        {children}
      </CountdownBody>
    </Modal>
  );
}

function CountdownBody({
  children,
  confirmLabel,
  cancelLabel,
  seconds,
  busy,
  onConfirm,
  onClose,
}: {
  children: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  seconds: number;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  /**
   * Derived from a deadline rather than counted down tick by tick: the button
   * then arms after `seconds` of real time no matter how the ticks behave —
   * a throttled background tab, a missed frame, or React invoking the updater
   * twice cannot lengthen or shorten the guard.
   */
  const [deadline] = useState(() => Date.now() + seconds * 1000);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  const remaining = Math.max(0, Math.ceil((deadline - now) / 1000));
  const armed = remaining <= 0;

  return (
    <>
      <div className="text-sm text-ink-soft">{children}</div>
      {/* Announced, not just shown: a purely visual timer leaves a screen
          reader user staring at a button that is inexplicably dead. */}
      <p aria-live="polite" className="mt-4 h-5 text-[13px] text-ink-faint">
        {armed ? "" : `Available in ${remaining}s…`}
      </p>
      <div className="mt-2 flex justify-end gap-3">
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          {cancelLabel}
        </Button>
        <Button variant="danger" disabled={!armed || busy} onClick={onConfirm}>
          {busy ? (
            <Spinner />
          ) : armed ? (
            confirmLabel
          ) : (
            `${confirmLabel} (${remaining})`
          )}
        </Button>
      </div>
    </>
  );
}
