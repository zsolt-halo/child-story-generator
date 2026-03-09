import type { ReactNode } from "react";

interface PickerCardProps {
  selected: boolean;
  onClick: () => void;
  title: string;
  subtitle?: string;
  description?: string;
  icon?: ReactNode;
}

export function PickerCard({ selected, onClick, title, subtitle, description, icon }: PickerCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left w-full p-4 rounded-[var(--radius-card)] border-2 transition-all ${
        selected
          ? "border-amber-400 bg-amber-50 shadow-sm"
          : "border-bark-100 bg-white hover:border-bark-200 hover:shadow-sm"
      }`}
    >
      <div className="flex items-start gap-3">
        {icon && <div className="text-2xl shrink-0 mt-0.5">{icon}</div>}
        <div className="min-w-0">
          <div className="font-bold text-sm text-bark-800">{title}</div>
          {subtitle && <div className="text-xs text-bark-400 mt-0.5">{subtitle}</div>}
          {description && (
            <p className="text-xs text-bark-500 mt-2 line-clamp-3 leading-relaxed">{description}</p>
          )}
        </div>
      </div>
    </button>
  );
}
