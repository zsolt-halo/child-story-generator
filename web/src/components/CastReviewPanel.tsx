import { useState, useEffect } from "react";
import type { CastMember } from "../api/types";

interface CastReviewPanelProps {
  initialCast: CastMember[];
  onApprove: (cast: CastMember[]) => void;
  approving?: boolean;
}

const emptyCastMember: CastMember = {
  name: "",
  role: "",
  species: "",
  visual_description: "",
  visual_constants: "",
  appears_on_pages: [],
};

export function CastReviewPanel({ initialCast, onApprove, approving }: CastReviewPanelProps) {
  const [cast, setCast] = useState<CastMember[]>([]);

  useEffect(() => {
    setCast(initialCast.map((c) => ({ ...c })));
  }, [initialCast]);

  const updateMember = (idx: number, field: keyof CastMember, value: unknown) => {
    setCast((prev) => prev.map((m, i) => (i === idx ? { ...m, [field]: value } : m)));
  };

  const removeMember = (idx: number) => {
    setCast((prev) => prev.filter((_, i) => i !== idx));
  };

  const addMember = () => {
    setCast((prev) => [...prev, { ...emptyCastMember }]);
  };

  const parsePages = (value: string): number[] => {
    return value
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n));
  };

  return (
    <div className="bg-white rounded-[var(--radius-card)] border border-bark-100 p-6 shadow-sm">
      <div className="mb-5">
        <h2 className="text-lg font-bold text-bark-800">Cast Review</h2>
        <p className="text-sm text-bark-400 mt-1">
          Review and edit character descriptions before illustration begins. These descriptions
          ensure visual consistency across all pages.
        </p>
      </div>

      <div className="space-y-4">
        {cast.map((member, idx) => (
          <div
            key={idx}
            className="bg-cream rounded-xl p-4 border border-bark-100 space-y-3"
          >
            <div className="flex items-start justify-between">
              <div className="grid grid-cols-3 gap-3 flex-1 mr-3">
                <label className="block">
                  <span className="text-[10px] font-semibold text-bark-500 uppercase tracking-wide">
                    Name
                  </span>
                  <input
                    type="text"
                    value={member.name}
                    onChange={(e) => updateMember(idx, "name", e.target.value)}
                    className="mt-1 w-full px-2.5 py-1.5 bg-white border border-bark-200 rounded-[var(--radius-btn)] text-sm text-bark-800 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] font-semibold text-bark-500 uppercase tracking-wide">
                    Role
                  </span>
                  <input
                    type="text"
                    value={member.role}
                    onChange={(e) => updateMember(idx, "role", e.target.value)}
                    className="mt-1 w-full px-2.5 py-1.5 bg-white border border-bark-200 rounded-[var(--radius-btn)] text-sm text-bark-800 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] font-semibold text-bark-500 uppercase tracking-wide">
                    Species
                  </span>
                  <input
                    type="text"
                    value={member.species}
                    onChange={(e) => updateMember(idx, "species", e.target.value)}
                    className="mt-1 w-full px-2.5 py-1.5 bg-white border border-bark-200 rounded-[var(--radius-btn)] text-sm text-bark-800 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400"
                  />
                </label>
              </div>
              <button
                onClick={() => removeMember(idx)}
                className="p-1.5 text-bark-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors mt-4"
                title="Remove cast member"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                </svg>
              </button>
            </div>

            <label className="block">
              <span className="text-[10px] font-semibold text-bark-500 uppercase tracking-wide">
                Visual Description
              </span>
              <textarea
                value={member.visual_description}
                onChange={(e) => updateMember(idx, "visual_description", e.target.value)}
                rows={3}
                className="mt-1 w-full px-2.5 py-1.5 bg-white border border-bark-200 rounded-[var(--radius-btn)] text-sm text-bark-800 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 resize-none"
              />
            </label>

            <label className="block">
              <span className="text-[10px] font-semibold text-bark-500 uppercase tracking-wide">
                Visual Constants
              </span>
              <textarea
                value={member.visual_constants}
                onChange={(e) => updateMember(idx, "visual_constants", e.target.value)}
                rows={2}
                className="mt-1 w-full px-2.5 py-1.5 bg-white border border-bark-200 rounded-[var(--radius-btn)] text-sm text-bark-800 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 resize-none"
              />
            </label>

            <label className="block">
              <span className="text-[10px] font-semibold text-bark-500 uppercase tracking-wide">
                Appears on Pages (comma-separated)
              </span>
              <input
                type="text"
                value={member.appears_on_pages.join(", ")}
                onChange={(e) => updateMember(idx, "appears_on_pages", parsePages(e.target.value))}
                className="mt-1 w-full px-2.5 py-1.5 bg-white border border-bark-200 rounded-[var(--radius-btn)] text-sm text-bark-800 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400"
              />
            </label>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between mt-5 pt-5 border-t border-bark-100">
        <button
          onClick={addMember}
          className="px-4 py-2 text-xs font-medium text-bark-600 bg-bark-50 hover:bg-bark-100 rounded-[var(--radius-btn)] transition-colors inline-flex items-center gap-1.5"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Add Cast Member
        </button>
        <button
          onClick={() => onApprove(cast)}
          disabled={approving}
          className="px-6 py-2.5 text-sm font-semibold text-white bg-sage-600 hover:bg-sage-700 disabled:opacity-60 disabled:cursor-not-allowed rounded-[var(--radius-btn)] transition-colors"
        >
          {approving ? "Continuing..." : "Approve & Continue"}
        </button>
      </div>
    </div>
  );
}
