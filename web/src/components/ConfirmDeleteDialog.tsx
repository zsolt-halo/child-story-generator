import { useEffect } from "react";

interface ConfirmDeleteDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  itemName: string;
  details?: string[];
  warning?: string;
  isDeleting: boolean;
  error?: string | null;
}

export function ConfirmDeleteDialog({
  open,
  onClose,
  onConfirm,
  title,
  itemName,
  details,
  warning,
  isDeleting,
  error,
}: ConfirmDeleteDialogProps) {
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-bark-900/40 backdrop-blur-sm z-40" onClick={onClose} />

      {/* Dialog */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
          <div className="px-6 py-5">
            {/* Header */}
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                </svg>
              </div>
              <h2 className="text-lg font-bold text-bark-800">{title}</h2>
            </div>

            {/* Body */}
            <p className="text-sm text-bark-600 mb-3">
              Are you sure you want to delete <span className="font-semibold text-bark-800">"{itemName}"</span>?
            </p>

            {details && details.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {details.map((d) => (
                  <span key={d} className="px-2.5 py-1 bg-bark-100 text-bark-600 text-xs rounded-full">
                    {d}
                  </span>
                ))}
              </div>
            )}

            {warning && (
              <p className="text-xs text-red-600 mb-1">{warning}</p>
            )}

            {error && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-3">{error}</p>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-bark-100 flex gap-3">
            <button
              onClick={onClose}
              disabled={isDeleting}
              className="flex-1 py-2.5 text-sm font-medium text-bark-600 bg-bark-50 hover:bg-bark-100 rounded-[var(--radius-btn)] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              disabled={isDeleting}
              className="flex-1 py-2.5 text-sm font-semibold text-white bg-red-500 hover:bg-red-600 disabled:opacity-60 disabled:cursor-not-allowed rounded-[var(--radius-btn)] transition-colors"
            >
              {isDeleting ? "Deleting..." : "Delete Story"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
