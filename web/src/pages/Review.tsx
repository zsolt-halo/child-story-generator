import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getStory, updateStory, startSanityCheck, checkSinglePage, startAutoFix,
  startIllustratePage, startPdf, getTaskStatus, branchStory, deleteStory,
} from "../api/client";
import { useSSE } from "../hooks/useSSE";
import type { Keyframe, SanityCheckResult, SSEEvent, BranchRequest } from "../api/types";
import { usePipelineStore } from "../stores/pipelineStore";
import { thumb } from "../components/FadeImage";
import { BranchDialog } from "../components/BranchDialog";
import { ConfirmDeleteDialog } from "../components/ConfirmDeleteDialog";

// ── Helpers ──────────────────────────────────────────────────────────

type TextSnapshot = Record<number, { text: string; translated: string | null }>;

function buildSnapshot(keyframes: Keyframe[]): TextSnapshot {
  const snap: TextSnapshot = {};
  for (const kf of keyframes) {
    snap[kf.page_number] = { text: kf.page_text, translated: kf.page_text_translated };
  }
  return snap;
}

function snapshotKey(slug: string) {
  return `starlight-render-snapshot-${slug}`;
}

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
        className="group relative cursor-text rounded-lg px-3 py-2 -mx-3 -my-2 hover:bg-amber-50/60 transition-colors"
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
        className={`w-full px-3 py-2 bg-cream border border-amber-300 rounded-[var(--radius-btn)] text-sm leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-amber-400/40 ${fontClass ?? ""} text-bark-800`}
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
            className="px-3 py-1 text-[11px] font-semibold text-white bg-amber-500 hover:bg-amber-600 disabled:opacity-40 rounded-[var(--radius-btn)] transition-colors"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────

export function Review() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setTaskId = usePipelineStore((s) => s.setTaskId);
  const [activePage, setActivePage] = useState<number | null>(null);
  const [sanityResults, setSanityResults] = useState<Record<number, SanityCheckResult>>({});
  const [sanityTaskId, setSanityTaskId] = useState<string | null>(null);
  const [checkingPage, setCheckingPage] = useState<number | null>(null);
  const [fixingPage, setFixingPage] = useState<number | null>(null);
  const [renderingPdf, setRenderingPdf] = useState(false);
  const [pdfTaskId, setPdfTaskId] = useState<string | null>(null);
  const [showBranch, setShowBranch] = useState(false);
  const [branching, setBranching] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Render snapshot — tracks what text was baked into the last PDF
  const [renderSnapshot, setRenderSnapshot] = useState<TextSnapshot | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["story", slug],
    queryFn: () => getStory(slug!),
    enabled: !!slug,
  });

  const hasPdfs = data?.has_pdf || data?.has_screen_pdf;

  // Load render snapshot from localStorage
  useEffect(() => {
    if (!slug) return;
    const stored = localStorage.getItem(snapshotKey(slug));
    if (stored) {
      try { setRenderSnapshot(JSON.parse(stored)); } catch { /* ignore corrupt */ }
    }
  }, [slug]);

  // Initialize snapshot for legacy stories (PDFs exist but no snapshot stored)
  useEffect(() => {
    if (!data || !slug || !hasPdfs) return;
    if (renderSnapshot !== null) return;
    const snap = buildSnapshot(data.story.keyframes);
    setRenderSnapshot(snap);
    localStorage.setItem(snapshotKey(slug), JSON.stringify(snap));
  }, [data, slug, hasPdfs, renderSnapshot]);

  // Compute pages with text changes since last render
  const modifiedPages = useMemo(() => {
    if (!renderSnapshot || !data) return new Set<number>();
    const modified = new Set<number>();
    for (const kf of data.story.keyframes) {
      const snap = renderSnapshot[kf.page_number];
      if (!snap) { modified.add(kf.page_number); continue; }
      if (kf.page_text !== snap.text || (kf.page_text_translated ?? null) !== snap.translated) {
        modified.add(kf.page_number);
      }
    }
    return modified;
  }, [data, renderSnapshot]);

  const modifiedCount = modifiedPages.size;

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

  const handlePdfEvent = useCallback((event: SSEEvent) => {
    if (event.type === "task_complete") {
      setPdfTaskId(null);
      setRenderingPdf(false);
      queryClient.invalidateQueries({ queryKey: ["story", slug] });
    }
    if (event.type === "error") {
      setPdfTaskId(null);
      setRenderingPdf(false);
    }
  }, [queryClient, slug]);

  useSSE(pdfTaskId, "/api/pipeline/progress", handlePdfEvent);

  // Fallback poll
  const pdfPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!pdfTaskId) {
      if (pdfPollRef.current) clearInterval(pdfPollRef.current);
      return;
    }
    pdfPollRef.current = setInterval(async () => {
      try {
        const status = await getTaskStatus(pdfTaskId);
        if (status.status === "completed") {
          setPdfTaskId(null);
          setRenderingPdf(false);
          queryClient.invalidateQueries({ queryKey: ["story", slug] });
        } else if (status.status === "failed") {
          setPdfTaskId(null);
          setRenderingPdf(false);
        }
      } catch { /* ignore */ }
    }, 5000);
    return () => { if (pdfPollRef.current) clearInterval(pdfPollRef.current); };
  }, [pdfTaskId, queryClient, slug]);

  // ── Action handlers ──────────────────────────────────────────────

  const runFullSanityCheck = async () => {
    if (!slug) return;
    setSanityResults({});
    const res = await startSanityCheck(slug);
    setSanityTaskId(res.task_id);
  };

  const runPageCheck = async (page: number) => {
    if (!slug) return;
    setCheckingPage(page);
    try {
      const result = await checkSinglePage(slug, page);
      setSanityResults((prev) => ({ ...prev, [page]: result }));
    } finally {
      setCheckingPage(null);
    }
  };

  const runAutoFix = async (page: number) => {
    if (!slug) return;
    setFixingPage(page);
    try {
      const res = await startAutoFix(slug, page);
      setTaskId(res.task_id);
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["story", slug] });
        setFixingPage(null);
      }, 15000);
    } catch {
      setFixingPage(null);
    }
  };

  const handleRegenerate = async (page: number) => {
    if (!slug) return;
    const res = await startIllustratePage(slug, page);
    setTaskId(res.task_id);
    setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: ["story", slug] });
    }, 20000);
  };

  const handleRenderPdf = async () => {
    if (!slug || !data) return;
    setRenderingPdf(true);
    try {
      // Snapshot current text — this is what gets baked into the PDF
      const snap = buildSnapshot(data.story.keyframes);
      setRenderSnapshot(snap);
      localStorage.setItem(snapshotKey(slug), JSON.stringify(snap));

      const res = await startPdf(slug);
      setPdfTaskId(res.task_id);
    } catch {
      setRenderingPdf(false);
    }
  };

  const handleTextSave = useCallback(
    async (pageNumber: number, field: "page_text" | "page_text_translated", value: string) => {
      if (!slug) return;
      await updateStory(slug, {
        keyframes: { [pageNumber]: { [field]: value } },
      });
      queryClient.invalidateQueries({ queryKey: ["story", slug] });
    },
    [slug, queryClient],
  );

  const handleBranch = async (req: BranchRequest) => {
    if (!slug) return;
    setBranching(true);
    try {
      const res = await branchStory(slug, req);
      setTaskId(res.task_id);
      setShowBranch(false);
      navigate("/stories/_/pipeline", { state: { taskId: res.task_id } });
    } catch (err) {
      console.error("Failed to branch story:", err);
    } finally {
      setBranching(false);
    }
  };

  const handleDelete = async () => {
    if (!slug) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteStory(slug);
      navigate("/stories");
    } catch (err) {
      setDeleteError(String(err));
    } finally {
      setDeleting(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────

  if (isLoading) {
    return <div className="animate-pulse"><div className="h-8 bg-bark-100 rounded w-48 mb-6" /></div>;
  }

  if (!data) {
    return <p className="text-bark-400">Story not found.</p>;
  }

  const currentKf = data.story.keyframes.find((kf) => kf.page_number === activePage) ??
    data.story.keyframes[0];
  const currentImageUrl = currentKf ? data.image_urls[currentKf.page_number] : undefined;
  const currentSanity = currentKf ? sanityResults[currentKf.page_number] : undefined;
  const currentPageModified = currentKf ? modifiedPages.has(currentKf.page_number) : false;

  if (activePage === null && data.story.keyframes.length > 0) {
    setActivePage(data.story.keyframes[0].page_number);
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-bark-800">{data.story.title}</h1>
          <p className="text-sm text-bark-400 mt-0.5">Illustration Review</p>
        </div>
        <div className="flex gap-2">
          {data.metadata && (
            <button
              onClick={() => setShowBranch(true)}
              className="px-4 py-2 text-xs font-medium text-bark-600 bg-white border border-bark-200 hover:bg-bark-50 rounded-[var(--radius-btn)] transition-colors"
            >
              Branch
            </button>
          )}
          <Link
            to={`/stories/${slug}/storyboard`}
            className="px-4 py-2 text-xs font-medium text-bark-600 bg-white border border-bark-200 hover:bg-bark-50 rounded-[var(--radius-btn)] transition-colors"
          >
            Storyboard
          </Link>
          <button
            onClick={runFullSanityCheck}
            disabled={!!sanityTaskId}
            className="px-4 py-2 text-xs font-semibold text-white bg-sage-600 hover:bg-sage-700 disabled:opacity-60 rounded-[var(--radius-btn)] transition-colors"
          >
            {sanityTaskId ? "Checking..." : "Sanity Check All"}
          </button>
          <button
            onClick={() => setShowDelete(true)}
            className="px-4 py-2 text-xs font-medium text-red-600 bg-white border border-red-200 hover:bg-red-50 rounded-[var(--radius-btn)] transition-colors"
          >
            Delete
          </button>
        </div>
      </div>

      {/* PDF Download / Render bar */}
      <div className={`mb-6 p-4 rounded-[var(--radius-card)] border flex items-center justify-between ${
        hasPdfs
          ? modifiedCount > 0
            ? "bg-amber-50 border-amber-300"
            : "bg-sage-50 border-sage-200"
          : "bg-amber-50 border-amber-200"
      }`}>
        {hasPdfs ? (
          <>
            <div className="flex items-center gap-3">
              <span className="text-lg">{modifiedCount > 0 ? "\u270F\uFE0F" : "\uD83D\uDCD6"}</span>
              <div>
                {modifiedCount > 0 ? (
                  <>
                    <p className="text-sm font-semibold text-amber-800">
                      {modifiedCount} {modifiedCount === 1 ? "page" : "pages"} modified since last render
                    </p>
                    <p className="text-xs text-amber-600">Re-render to update your PDFs with the latest text</p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-semibold text-sage-800">PDFs are ready!</p>
                    <p className="text-xs text-sage-600">Download your book or view the spread preview</p>
                  </>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {data.has_screen_pdf && (
                <a
                  href={`/api/stories/${slug}/pdf/screen`}
                  download
                  className="px-4 py-2.5 text-xs font-semibold text-white bg-sage-600 hover:bg-sage-700 rounded-[var(--radius-btn)] transition-colors inline-flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                  </svg>
                  Screen PDF
                </a>
              )}
              {data.has_pdf && (
                <a
                  href={`/api/stories/${slug}/pdf/print`}
                  download
                  className="px-4 py-2.5 text-xs font-semibold text-bark-700 bg-white border border-bark-200 hover:bg-bark-50 rounded-[var(--radius-btn)] transition-colors inline-flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                  </svg>
                  Print PDF
                </a>
              )}
              {data.has_spread_pdf && (
                <Link
                  to={`/stories/${slug}/book`}
                  className="px-4 py-2.5 text-xs font-medium text-bark-600 bg-white border border-bark-200 hover:bg-bark-50 rounded-[var(--radius-btn)] transition-colors"
                >
                  View Spreads
                </Link>
              )}
              <button
                onClick={handleRenderPdf}
                disabled={renderingPdf}
                className={`relative px-4 py-2.5 text-xs font-semibold rounded-[var(--radius-btn)] transition-colors inline-flex items-center gap-2 disabled:opacity-60 ${
                  modifiedCount > 0 && !renderingPdf
                    ? "text-white bg-amber-500 hover:bg-amber-600 rerender-pulse"
                    : "text-bark-500 bg-white border border-bark-200 hover:bg-bark-50"
                }`}
              >
                {renderingPdf ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Rendering...
                  </>
                ) : modifiedCount > 0 ? (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
                    </svg>
                    Re-render
                    <span className="ml-0.5 px-1.5 py-0.5 text-[10px] font-bold bg-white/25 rounded-full">
                      {modifiedCount}
                    </span>
                  </>
                ) : (
                  "Re-render"
                )}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <span className="text-lg">{"\uD83D\uDCC4"}</span>
              <div>
                <p className="text-sm font-semibold text-amber-800">No PDF yet</p>
                <p className="text-xs text-amber-600">Render a PDF to download and share your book</p>
              </div>
            </div>
            <button
              onClick={handleRenderPdf}
              disabled={renderingPdf}
              className="px-5 py-2.5 text-sm font-semibold text-white bg-amber-500 hover:bg-amber-600 disabled:opacity-60 rounded-[var(--radius-btn)] transition-colors inline-flex items-center gap-2"
            >
              {renderingPdf ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Rendering PDF...
                </>
              ) : (
                "Render PDF"
              )}
            </button>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main image + details */}
        <div className="lg:col-span-2 space-y-4">
          {/* Image */}
          {currentImageUrl ? (
            <div className="relative rounded-[var(--radius-card)] overflow-hidden bg-white border border-bark-100 shadow-sm">
              <img
                src={`${currentImageUrl}?t=${Date.now()}`}
                alt={currentKf?.is_cover ? "Cover" : `Page ${currentKf?.page_number}`}
                className="w-full aspect-square object-cover"
              />
              {currentKf?.is_cover && (
                <span className="absolute top-3 left-3 px-3 py-1 bg-amber-500/90 text-white text-xs font-semibold rounded-full">
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
                  className="px-4 py-2 text-xs font-semibold text-white bg-amber-500 hover:bg-amber-600 disabled:opacity-60 rounded-[var(--radius-btn)] transition-colors"
                >
                  {fixingPage === currentKf.page_number ? "Fixing..." : "Auto-Fix"}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Sidebar: editable text + actions */}
        <div className="space-y-4">
          {/* Editable page text */}
          {currentKf && (
            <div className="bg-white rounded-[var(--radius-card)] border border-bark-100 p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold text-bark-400 uppercase tracking-wide">
                  Page Text
                </h3>
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

          {/* Visual description (read-only) */}
          {currentKf && (
            <div className="bg-white rounded-[var(--radius-card)] border border-bark-100 p-5 shadow-sm">
              <h3 className="text-xs font-semibold text-bark-400 uppercase tracking-wide mb-2">
                Visual Description
              </h3>
              <p className="text-xs leading-relaxed text-bark-600">
                {currentKf.visual_description}
              </p>
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
                className="flex-1 px-3 py-2 text-xs font-medium text-white bg-bark-600 hover:bg-bark-700 rounded-[var(--radius-btn)] transition-colors"
              >
                Regenerate
              </button>
            </div>
          )}

          {/* Thumbnail strip */}
          <div className="bg-white rounded-[var(--radius-card)] border border-bark-100 p-3 shadow-sm">
            <h3 className="text-xs font-semibold text-bark-400 uppercase tracking-wide mb-2">
              Pages
            </h3>
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
                      isActive ? "border-amber-400 shadow-sm" : "border-transparent hover:border-bark-200"
                    }`}
                  >
                    {imgUrl ? (
                      <img src={thumb(imgUrl, 200)} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-bark-100 flex items-center justify-center">
                        <span className="text-bark-300 text-[10px] font-bold">{kf.page_number}</span>
                      </div>
                    )}
                    {/* Sanity badge — top right */}
                    {sanity && (
                      <span className={`absolute top-0.5 right-0.5 w-2.5 h-2.5 rounded-full border border-white ${
                        sanity.status === "pass" ? "bg-sage-500" :
                        sanity.status === "trivial" ? "bg-amber-400" :
                        "bg-red-500"
                      }`} />
                    )}
                    {/* Modified since render — top left */}
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

      {/* Branch dialog */}
      {data.metadata && (
        <BranchDialog
          open={showBranch}
          onClose={() => setShowBranch(false)}
          onBranch={handleBranch}
          metadata={data.metadata}
          sourceTitle={data.story.title}
          branching={branching}
        />
      )}

      {/* Delete dialog */}
      <ConfirmDeleteDialog
        open={showDelete}
        onClose={() => setShowDelete(false)}
        onConfirm={handleDelete}
        title="Delete Story"
        itemName={data.story.title}
        details={[
          `${data.story.keyframes.length} pages`,
          ...(Object.keys(data.image_urls).length > 0 ? [`${Object.keys(data.image_urls).length} illustrations`] : []),
          ...(data.has_pdf ? ["Has PDF"] : []),
        ]}
        warning="This will permanently delete the story, all illustrations, and PDFs. This cannot be undone."
        isDeleting={deleting}
        error={deleteError}
      />
    </div>
  );
}
