import { useState, useEffect } from "react";
import type { Keyframe } from "../api/types";

interface PageEditorDrawerProps {
  keyframe: Keyframe | null;
  imageUrl?: string;
  open: boolean;
  onClose: () => void;
  onSave: (pageNumber: number, updates: { page_text?: string; visual_description?: string; mood?: string }) => void;
  onRegenerate?: (pageNumber: number) => void;
}

export function PageEditorDrawer({ keyframe, imageUrl, open, onClose, onSave, onRegenerate }: PageEditorDrawerProps) {
  const [text, setText] = useState("");
  const [visual, setVisual] = useState("");
  const [mood, setMood] = useState("");

  useEffect(() => {
    if (keyframe) {
      setText(keyframe.page_text);
      setVisual(keyframe.visual_description);
      setMood(keyframe.mood);
    }
  }, [keyframe]);

  if (!keyframe) return null;

  const hasChanges =
    text !== keyframe.page_text ||
    visual !== keyframe.visual_description ||
    mood !== keyframe.mood;

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 bg-bark-900/30 backdrop-blur-sm z-40"
          onClick={onClose}
        />
      )}

      {/* Drawer */}
      <div
        className={`fixed top-0 right-0 h-full w-full max-w-lg bg-white shadow-xl z-50 transform transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="h-full flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-bark-100">
            <div>
              <h3 className="font-bold text-bark-800">
                {keyframe.is_cover ? "Cover Page" : `Page ${keyframe.page_number}`}
              </h3>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-bark-50 rounded-lg transition-colors"
            >
              <svg className="w-5 h-5 text-bark-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            {/* Image preview */}
            {imageUrl && (
              <div className="relative rounded-xl overflow-hidden">
                <img src={imageUrl} alt="Page illustration" className="w-full aspect-square object-cover" />
                {onRegenerate && (
                  <button
                    onClick={() => onRegenerate(keyframe.page_number)}
                    className="absolute bottom-3 right-3 px-3 py-1.5 bg-bark-800/80 hover:bg-bark-800 text-white text-xs font-medium rounded-lg backdrop-blur-sm transition-colors"
                  >
                    Regenerate
                  </button>
                )}
              </div>
            )}

            {/* Page text */}
            <label className="block">
              <span className="text-xs font-semibold text-bark-500 uppercase tracking-wide">Page Text</span>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={5}
                className="mt-1.5 w-full px-3 py-2.5 bg-cream border border-bark-200 rounded-[var(--radius-btn)] text-sm font-[family-name:var(--font-story)] text-bark-800 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 resize-none"
              />
            </label>

            {/* Visual description */}
            <label className="block">
              <span className="text-xs font-semibold text-bark-500 uppercase tracking-wide">Visual Description</span>
              <textarea
                value={visual}
                onChange={(e) => setVisual(e.target.value)}
                rows={4}
                className="mt-1.5 w-full px-3 py-2.5 bg-cream border border-bark-200 rounded-[var(--radius-btn)] text-sm text-bark-800 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 resize-none"
              />
            </label>

            {/* Mood */}
            <label className="block">
              <span className="text-xs font-semibold text-bark-500 uppercase tracking-wide">Mood</span>
              <input
                type="text"
                value={mood}
                onChange={(e) => setMood(e.target.value)}
                className="mt-1.5 w-full px-3 py-2.5 bg-cream border border-bark-200 rounded-[var(--radius-btn)] text-sm text-bark-800 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400"
              />
            </label>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-bark-100 flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 text-sm font-medium text-bark-600 bg-bark-50 hover:bg-bark-100 rounded-[var(--radius-btn)] transition-colors"
            >
              Cancel
            </button>
            <button
              disabled={!hasChanges}
              onClick={() => {
                onSave(keyframe.page_number, {
                  page_text: text !== keyframe.page_text ? text : undefined,
                  visual_description: visual !== keyframe.visual_description ? visual : undefined,
                  mood: mood !== keyframe.mood ? mood : undefined,
                });
                onClose();
              }}
              className="flex-1 py-2.5 text-sm font-medium text-white bg-amber-500 hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed rounded-[var(--radius-btn)] transition-colors"
            >
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
