import { useState, useCallback, useEffect, useRef } from "react";
import {
  updateStory, startSanityCheck, checkSinglePage, startAutoFix,
  startIllustratePage,
} from "../../api/client";
import { useSSE } from "../../hooks/useSSE";
import { useRenderSnapshot } from "../../hooks/useRenderSnapshot";
import { usePipelineStore } from "../../stores/pipelineStore";
import { thumb } from "../FadeImage";
import type { StoryDetail, SanityCheckResult, SSEEvent } from "../../api/types";

// ── Inline Edit Component ────────────────────────────────────────────

function InlineEdit({
  value,
  onSave,
  fontClass,
  colorClass,
}: {
  value: string;
  onSave: (value: string) => Promise<void>;
  fontClass?: string;
  colorClass?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { setDraft(value); }, [value]);

  useEffect(() => {
    if (editing && textareaRef.current) {
      const ta = textareaRef.current;
      ta.focus();
      ta.selectionStart = ta.value.length;
      ta.style.height = "auto";
      ta.style.height = ta.scrollHeight + "px";
    }
  }, [editing]);

  const handleSave = async () => {
    if (draft.trim() === value.trim()) { setEditing(false); return; }
    setSaving(true);
    try {
      await onSave(draft);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <div
        className="group relative cursor-text rounded-lg px-3 py-2 -mx-3 -my-2 hover:bg-sage-50/60 transition-colors"
        onClick={() => setEditing(true)}
      >
        <p className={`text-sm leading-relaxed whitespace-pre-wrap ${fontClass ?? ""} ${colorClass ?? "text-bark-700"}`}>
          {value}
        </p>
        <span className="absolute top-2 right-2 opacity-0 group-hover:opacity-60 transition-opacity text-bark-400">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125" />
          </svg>
        </span>
      </div>
    );
  }

  return (
    <div className="-mx-3 -my-2">
      <textarea
        ref={textareaRef}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          e.target.style.height = "auto";
          e.target.style.height = e.target.scrollHeight + "px";
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            handleSave();
          }
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
        className={`w-full px-3 py-2 bg-cream border border-sage-300 rounded-[var(--radius-btn)] text-sm leading-relaxed resize-none focus:outline-none focus-visible:ring-2 focus-visible:ring-sage-400 ${fontClass ?? ""} text-bark-800`}
      />
      <div className="flex items-center justify-between mt-2 px-1">
        <span className="text-[10px] text-bark-300">Esc cancel · Ctrl+Enter save</span>
        <div className="flex gap-2">
          <button
            onClick={() => { setDraft(value); setEditing(false); }}
            className="px-3 py-1 text-[11px] font-medium text-bark-500 hover:text-bark-700 rounded transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || draft.trim() === value.trim()}
            className="px-3 py-1 text-[11px] font-semibold text-white bg-sage-600 hover:bg-sage-700 disabled:opacity-40 rounded-[var(--radius-btn)] transition-colors active:scale-[0.97]"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────

interface IllustrationsTabProps {
  slug: string;
  data: StoryDetail;
  invalidate: () => void;
}

export function IllustrationsTab({ slug, data, invalidate }: IllustrationsTabProps) {
  const setTaskId = usePipelineStore((s) => s.setTaskId);
  const [activePage, setActivePage] = useState<number | null>(null);
  const [sanityResults, setSanityResults] = useState<Record<number, SanityCheckResult>>({});
  const [sanityTaskId, setSanityTaskId] = useState<string | null>(null);
  const [checkingPage, setCheckingPage] = useState<number | null>(null);
  const [fixingPage, setFixingPage] = useState<number | null>(null);

  const hasPdfs = data.has_pdf || data.has_screen_pdf;
  const { modifiedPages } = useRenderSnapshot(slug, data.story.keyframes, hasPdfs);

  // ── SSE handlers ─────────────────────────────────────────────────

  const handleSanityEvent = useCallback((event: SSEEvent) => {
    if (event.type === "sanity_progress" && event.result) {
      const result = event.result as unknown as SanityCheckResult;
      setSanityResults((prev) => ({ ...prev, [result.page_number]: result }));
    }
    if (event.type === "task_complete" || event.type === "error") {
      setSanityTaskId(null);
    }
  }, []);

  useSSE(sanityTaskId, "/api/sanity/progress", handleSanityEvent);

  // ── Action handlers ──────────────────────────────────────────────

  const runFullSanityCheck = async () => {
    setSanityResults({});
    const res = await startSanityCheck(slug);
    setSanityTaskId(res.task_id);
  };

  const runPageCheck = async (page: number) => {
    setCheckingPage(page);
    try {
      const result = await checkSinglePage(slug, page);
      setSanityResults((prev) => ({ ...prev, [page]: result }));
    } finally {
      setCheckingPage(null);
    }
  };

  const runAutoFix = async (page: number) => {
    setFixingPage(page);
    try {
      const res = await startAutoFix(slug, page);
      setTaskId(res.task_id);
      setTimeout(() => {
        invalidate();
        setFixingPage(null);
      }, 15000);
    } catch {
      setFixingPage(null);
    }
  };

  const handleRegenerate = async (page: number) => {
    const res = await startIllustratePage(slug, page);
    setTaskId(res.task_id);
    setTimeout(() => invalidate(), 20000);
  };

  const handleTextSave = useCallback(
    async (pageNumber: number, field: "page_text" | "page_text_translated", value: string) => {
      await updateStory(slug, {
        keyframes: { [pageNumber]: { [field]: value } },
      });
      invalidate();
    },
    [slug, invalidate],
  );

  // Set initial active page
  if (activePage === null && data.story.keyframes.length > 0) {
    setActivePage(data.story.keyframes[0].page_number);
  }

  // No images state
  if (Object.keys(data.image_urls).length === 0) {
    return (
      <div className="text-center py-16">
        <div className="w-16 h-16 mx-auto mb-4 bg-bark-100 rounded-full flex items-center justify-center">
          <svg className="w-8 h-8 text-bark-300" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
          </svg>
        </div>
        <h3 className="text-sm font-semibold text-bark-600 mb-1">No illustrations yet</h3>
        <p className="text-xs text-bark-400">Generate illustrations from the Pages tab first.</p>
      </div>
    );
  }

  const currentKf = data.story.keyframes.find((kf) => kf.page_number === activePage) ?? data.story.keyframes[0];
  const currentImageUrl = currentKf ? data.image_urls[currentKf.page_number] : undefined;
  const currentSanity = currentKf ? sanityResults[currentKf.page_number] : undefined;
  const currentPageModified = currentKf ? modifiedPages.has(currentKf.page_number) : false;

  return (
    <div>
      {/* Sanity check button */}
      <div className="flex justify-end mb-4">
        <button
          onClick={runFullSanityCheck}
          disabled={!!sanityTaskId}
          className="px-4 py-2 text-xs font-semibold text-white bg-sage-600 hover:bg-sage-700 disabled:opacity-60 rounded-[var(--radius-btn)] transition-colors active:scale-[0.97]"
        >
          {sanityTaskId ? "Checking..." : "Sanity Check All"}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main image + details */}
        <div className="lg:col-span-2 space-y-4">
          {currentImageUrl ? (
            <div className="relative rounded-[var(--radius-card)] overflow-hidden bg-white border border-bark-100 shadow-sm">
              <img
                src={`${currentImageUrl}?t=${Date.now()}`}
                alt={currentKf?.is_cover ? "Cover" : `Page ${currentKf?.page_number}`}
                className="w-full aspect-square object-cover"
              />
              {currentKf?.is_cover && (
                <span className="absolute top-3 left-3 px-3 py-1 bg-sage-500/90 text-white text-xs font-semibold rounded-full">
                  Cover
                </span>
              )}
            </div>
          ) : (
            <div className="aspect-square bg-bark-100 rounded-[var(--radius-card)] flex items-center justify-center">
              <p className="text-bark-400 text-sm">No illustration yet</p>
            </div>
          )}

          {/* Sanity check result */}
          {currentSanity && (
            <div className={`rounded-[var(--radius-card)] border p-4 ${
              currentSanity.status === "pass" ? "bg-sage-50 border-sage-200" :
              currentSanity.status === "trivial" ? "bg-amber-50 border-amber-200" :
              "bg-red-50 border-red-200"
            }`}>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-bold">
                  Sanity Check: {currentSanity.status === "pass" ? "Pass" :
                    currentSanity.status === "trivial" ? "Minor Issues" : "Major Issues"}
                </h3>
                <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full ${
                  currentSanity.status === "pass" ? "bg-sage-500 text-white" :
                  currentSanity.status === "trivial" ? "bg-amber-500 text-white" :
                  "bg-red-500 text-white"
                }`}>
                  {currentSanity.status.toUpperCase()}
                </span>
              </div>
              {currentSanity.issues.length > 0 && (
                <ul className="space-y-1 mb-3">
                  {currentSanity.issues.map((issue, i) => (
                    <li key={i} className="text-xs text-bark-600 flex items-start gap-2">
                      <span className={`mt-0.5 shrink-0 w-1.5 h-1.5 rounded-full ${
                        issue.severity === "trivial" ? "bg-amber-400" : "bg-red-400"
                      }`} />
                      {issue.description}
                    </li>
                  ))}
                </ul>
              )}
              {currentSanity.status === "trivial" && currentSanity.suggested_visual_description && currentKf && (
                <button
                  onClick={() => runAutoFix(currentKf.page_number)}
                  disabled={fixingPage === currentKf.page_number}
                  className="px-4 py-2 text-xs font-semibold text-white bg-amber-500 hover:bg-amber-600 disabled:opacity-60 rounded-[var(--radius-btn)] transition-colors active:scale-[0.97]"
                >
                  {fixingPage === currentKf.page_number ? "Fixing..." : "Auto-Fix"}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Editable page text */}
          {currentKf && (
            <div className="bg-white rounded-[var(--radius-card)] border border-bark-100 p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold text-bark-400 uppercase tracking-wide">Page Text</h3>
                {currentPageModified && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold text-amber-700 bg-amber-100 rounded-full">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                    Modified
                  </span>
                )}
              </div>
              <InlineEdit
                key={`text-${currentKf.page_number}`}
                value={currentKf.page_text}
                onSave={(val) => handleTextSave(currentKf.page_number, "page_text", val)}
                fontClass="font-[family-name:var(--font-story)]"
              />
              {currentKf.page_text_translated != null && (
                <>
                  <div className="flex items-center gap-2 my-3">
                    <div className="flex-1 h-px bg-bark-100" />
                    <span className="text-[10px] text-bark-300 font-medium uppercase tracking-wider">Translation</span>
                    <div className="flex-1 h-px bg-bark-100" />
                  </div>
                  <InlineEdit
                    key={`translated-${currentKf.page_number}`}
                    value={currentKf.page_text_translated}
                    onSave={(val) => handleTextSave(currentKf.page_number, "page_text_translated", val)}
                    fontClass="font-[family-name:var(--font-story)]"
                    colorClass="text-bark-500"
                  />
                </>
              )}
            </div>
          )}

          {/* Visual description */}
          {currentKf && (
            <div className="bg-white rounded-[var(--radius-card)] border border-bark-100 p-5 shadow-sm">
              <h3 className="text-xs font-semibold text-bark-400 uppercase tracking-wide mb-2">Visual Description</h3>
              <p className="text-xs leading-relaxed text-bark-600">{currentKf.visual_description}</p>
              <p className="text-[10px] text-bark-400 mt-2">Mood: {currentKf.mood}</p>
            </div>
          )}

          {/* Actions */}
          {currentKf && (
            <div className="flex gap-2">
              <button
                onClick={() => runPageCheck(currentKf.page_number)}
                disabled={checkingPage === currentKf.page_number}
                className="flex-1 px-3 py-2 text-xs font-medium text-bark-600 bg-white border border-bark-200 hover:bg-bark-50 disabled:opacity-40 rounded-[var(--radius-btn)] transition-colors"
              >
                {checkingPage === currentKf.page_number ? "Checking..." : "Check Page"}
              </button>
              <button
                onClick={() => handleRegenerate(currentKf.page_number)}
                className="flex-1 px-3 py-2 text-xs font-medium text-white bg-bark-600 hover:bg-bark-700 rounded-[var(--radius-btn)] transition-colors active:scale-[0.97]"
              >
                Regenerate
              </button>
            </div>
          )}

          {/* Thumbnail strip */}
          <div className="bg-white rounded-[var(--radius-card)] border border-bark-100 p-3 shadow-sm">
            <h3 className="text-xs font-semibold text-bark-400 uppercase tracking-wide mb-2">Pages</h3>
            <div className="grid grid-cols-4 gap-1.5">
              {data.story.keyframes.map((kf) => {
                const imgUrl = data.image_urls[kf.page_number];
                const sanity = sanityResults[kf.page_number];
                const isActive = kf.page_number === activePage;
                const isModified = modifiedPages.has(kf.page_number);
                return (
                  <button
                    key={kf.page_number}
                    onClick={() => setActivePage(kf.page_number)}
                    className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all ${
                      isActive ? "border-sage-400 shadow-sm" : "border-transparent hover:border-bark-200"
                    }`}
                  >
                    {imgUrl ? (
                      <img src={thumb(imgUrl, 200)} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-bark-100 flex items-center justify-center">
                        <span className="text-bark-300 text-[10px] font-bold">{kf.page_number}</span>
                      </div>
                    )}
                    {sanity && (
                      <span className={`absolute top-0.5 right-0.5 w-2.5 h-2.5 rounded-full border border-white ${
                        sanity.status === "pass" ? "bg-sage-500" :
                        sanity.status === "trivial" ? "bg-amber-400" :
                        "bg-red-500"
                      }`} />
                    )}
                    {isModified && (
                      <span className="absolute top-0.5 left-0.5 w-2.5 h-2.5 rounded-full border border-white bg-amber-400" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
