"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";

type AdminOperationModalProps = {
  open: boolean;
  title: string;
  subtitle: string;
  cancelLabel: string;
  confirmLabel: string;
  confirmLoadingLabel: string;
  loading?: boolean;
  danger?: boolean;
  onClose: () => void;
  onConfirm: () => void;
  children: ReactNode;
};

export function AdminOperationModal({
  open,
  title,
  subtitle,
  cancelLabel,
  confirmLabel,
  confirmLoadingLabel,
  loading = false,
  danger = false,
  onClose,
  onConfirm,
  children,
}: AdminOperationModalProps) {
  if (!open) return null;

  return (
    <div className="admin-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="admin-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-operation-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="admin-modal-head">
          <div>
            <h2 id="admin-operation-modal-title">{title}</h2>
            <p>{subtitle}</p>
          </div>
          <button type="button" className="admin-modal-close" onClick={onClose} aria-label={cancelLabel}>
            <X size={18} />
          </button>
        </div>
        <div className="admin-modal-body">{children}</div>
        <div className="admin-modal-actions">
          <button type="button" className="admin-secondary-button" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={danger ? "admin-secondary-button is-danger" : "admin-primary-button"}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? confirmLoadingLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
