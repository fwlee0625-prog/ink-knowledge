import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { AppButton } from "./AppButton";

export type ConfirmDialogOptions = {
  cancelText?: string;
  confirmText?: string;
  description: string;
  title: string;
  tone?: "default" | "warning" | "danger";
};

type ConfirmDialogProps = {
  onCancel: () => void;
  onConfirm: () => void;
  open: boolean;
  options: ConfirmDialogOptions | null;
};

export function ConfirmDialog({ onCancel, onConfirm, open, options }: ConfirmDialogProps) {
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    confirmButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel, open]);

  if (!open || !options) {
    return null;
  }

  return createPortal(
    <div className="dialog-layer" role="presentation">
      <button aria-label="关闭确认框" className="dialog-backdrop" onClick={onCancel} type="button" />
      <section
        aria-describedby="confirm-dialog-description"
        aria-modal="true"
        className={`confirm-dialog ${options.tone ?? "default"}`}
        role="alertdialog"
      >
        <div className="confirm-dialog-head">
          <span aria-hidden="true" className="confirm-dialog-icon" />
          <div>
            <h2>{options.title}</h2>
            <p id="confirm-dialog-description">{options.description}</p>
          </div>
        </div>
        <div className="confirm-dialog-actions">
          <AppButton onClick={onCancel}>{options.cancelText ?? "取消"}</AppButton>
          <AppButton onClick={onConfirm} ref={confirmButtonRef} variant="primary">
            {options.confirmText ?? "确认"}
          </AppButton>
        </div>
      </section>
    </div>,
    document.body,
  );
}
