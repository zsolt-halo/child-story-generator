import { useState, useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  startPdf, getTaskStatus, branchStory, deleteStory, startAnimate, getWorkerStatus,
} from "../../api/client";
import { useSSE } from "../../hooks/useSSE";
import { useRenderSnapshot } from "../../hooks/useRenderSnapshot";
import { usePipelineStore } from "../../stores/pipelineStore";
import { BranchDialog } from "../BranchDialog";
import { ConfirmDeleteDialog } from "../ConfirmDeleteDialog";
import type { StoryDetail, SSEEvent, BranchRequest } from "../../api/types";

interface BookTabProps {
  slug: string;
  data: StoryDetail;
  invalidate: () => void;
}

export function BookTab({ slug, data, invalidate }: BookTabProps) {
  const navigate = useNavigate();
  const setTaskId = usePipelineStore((s) => s.setTaskId);
  const [renderingPdf, setRenderingPdf] = useState(false);
  const [pdfTaskId, setPdfTaskId] = useState<string | null>(null);
  const [showBranch, setShowBranch] = useState(false);
  const [branching, setBranching] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [animating, setAnimating] = useState(false);

  const hasPdfs = data.has_pdf || data.has_screen_pdf;
  const { modifiedCount, saveSnapshot } = useRenderSnapshot(slug, data.story.keyframes, hasPdfs);

  const { data: workerStatus } = useQuery({
    queryKey: ["worker-status"],
    queryFn: getWorkerStatus,
    staleTime: 30_000,
  });

  // ── SSE for PDF rendering ──────────────────────────────────────────

  const handlePdfEvent = useCallback((event: SSEEvent) => {
    if (event.type === "task_complete") {
      setPdfTaskId(null);
      setRenderingPdf(false);
      invalidate();
    }
    if (event.type === "error") {
      setPdfTaskId(null);
      setRenderingPdf(false);
    }
  }, [invalidate]);

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
          invalidate();
        } else if (status.status === "failed") {
          setPdfTaskId(null);
          setRenderingPdf(false);
        }
      } catch { /* ignore */ }
    }, 5000);
    return () => { if (pdfPollRef.current) clearInterval(pdfPollRef.current); };
  }, [pdfTaskId, invalidate]);

  // ── Handlers ───────────────────────────────────────────────────────

  const handleRenderPdf = async () => {
    setRenderingPdf(true);
    try {
      saveSnapshot();
      const res = await startPdf(slug);
      setPdfTaskId(res.task_id);
    } catch {
      setRenderingPdf(false);
    }
  };

  const handleBranch = async (req: BranchRequest) => {
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

  const handleAnimate = async () => {
    setAnimating(true);
    try {
      const res = await startAnimate(slug);
      setTaskId(res.task_id);
      navigate(`/stories/${slug}/pipeline`, { state: { taskId: res.task_id } });
    } catch (err) {
      console.error("Failed to start animation:", err);
      setAnimating(false);
    }
  };

  return (
    <div>
      {/* PDF Render bar */}
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
              <button
                onClick={handleRenderPdf}
                disabled={renderingPdf}
                className={`relative px-4 py-2.5 text-xs font-semibold rounded-[var(--radius-btn)] transition-colors inline-flex items-center gap-2 disabled:opacity-60 active:scale-[0.97] ${
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
                  <>Re-render <span className="px-1.5 py-0.5 text-[10px] font-bold bg-white/25 rounded-full">{modifiedCount}</span></>
                ) : (
                  "Re-render"
                )}
              </button>
            </div>
          </>
        ) : (
          <>
            <div>
              <p className="text-sm font-semibold text-amber-800">No PDF yet</p>
              <p className="text-xs text-amber-600">Render a PDF to download and share your book</p>
            </div>
            <button
              onClick={handleRenderPdf}
              disabled={renderingPdf}
              className="px-5 py-2.5 text-sm font-semibold text-white bg-sage-600 hover:bg-sage-700 disabled:opacity-60 rounded-[var(--radius-btn)] transition-colors active:scale-[0.97]"
            >
              {renderingPdf ? "Rendering PDF..." : "Render PDF"}
            </button>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* PDF Preview */}
        <div className="lg:col-span-2">
          {data.has_spread_pdf ? (
            <div className="bg-white rounded-[var(--radius-card)] border border-bark-100 shadow-sm overflow-hidden">
              <iframe
                src={`/api/stories/${slug}/pdf/spreads`}
                className="w-full aspect-[16/10] border-0"
                title="Book Spreads Preview"
              />
            </div>
          ) : data.has_pdf ? (
            <div className="bg-white rounded-[var(--radius-card)] border border-bark-100 shadow-sm overflow-hidden">
              <iframe
                src={`/api/stories/${slug}/pdf/screen`}
                className="w-full aspect-[3/4] border-0"
                title="Book PDF Preview"
              />
            </div>
          ) : (
            <div className="aspect-[3/4] bg-bark-100 rounded-[var(--radius-card)] flex items-center justify-center">
              <div className="text-center">
                <p className="text-bark-400 text-sm mb-2">No PDF generated yet</p>
                <p className="text-bark-300 text-xs">Click "Render PDF" above to create your book</p>
              </div>
            </div>
          )}
        </div>

        {/* Sidebar: Downloads + Info + Actions */}
        <div className="space-y-4">
          {/* Downloads */}
          <div className="bg-white rounded-[var(--radius-card)] border border-bark-100 p-5 shadow-sm">
            <h2 className="font-bold text-bark-700 mb-4">Downloads</h2>
            <div className="space-y-3">
              {data.has_pdf && (
                <DownloadLink href={`/api/stories/${slug}/pdf/print`} label="Print PDF" description="300 DPI, 8.25x8.25 with bleed" />
              )}
              {data.has_screen_pdf && (
                <DownloadLink href={`/api/stories/${slug}/pdf/screen`} label="Screen PDF" description="120 DPI, optimized for sharing" />
              )}
              {data.has_spread_pdf && (
                <DownloadLink href={`/api/stories/${slug}/pdf/spreads`} label="Spreads PDF" description="Landscape view, how the book looks open" />
              )}
              {!data.has_pdf && !data.has_screen_pdf && !data.has_spread_pdf && (
                <p className="text-sm text-bark-400">No PDFs available yet.</p>
              )}
            </div>
          </div>

          {/* Story info */}
          <div className="bg-white rounded-[var(--radius-card)] border border-bark-100 p-5 shadow-sm">
            <h2 className="font-bold text-bark-700 mb-3">Story Info</h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-bark-400">Pages</dt>
                <dd className="text-bark-700 font-medium">{data.story.keyframes.length}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-bark-400">Images</dt>
                <dd className="text-bark-700 font-medium">{Object.keys(data.image_urls).length}</dd>
              </div>
              {data.story.title_translated && (
                <div className="flex justify-between">
                  <dt className="text-bark-400">Translated</dt>
                  <dd className="text-bark-700 font-medium truncate ml-4">{data.story.title_translated}</dd>
                </div>
              )}
            </dl>
          </div>

          {/* Actions */}
          <div className="bg-white rounded-[var(--radius-card)] border border-bark-100 p-5 shadow-sm space-y-3">
            {Object.keys(data.image_urls).length > 0 && (
              <button
                onClick={handleAnimate}
                disabled={animating}
                className="w-full px-4 py-2.5 text-xs font-semibold text-white bg-sage-500 hover:bg-sage-600 disabled:opacity-50 rounded-[var(--radius-btn)] transition-colors active:scale-[0.97]"
                title={workerStatus?.available ? "GPU worker connected" : "GPU worker not connected"}
              >
                {animating ? "Starting..." : "Animate Pages"}
                {workerStatus && !workerStatus.available && (
                  <span className="ml-1.5 inline-block w-2 h-2 rounded-full bg-rose-accent" />
                )}
                {workerStatus?.available && (
                  <span className="ml-1.5 inline-block w-2 h-2 rounded-full bg-sage-300" />
                )}
              </button>
            )}
            {data.metadata && (
              <button
                onClick={() => setShowBranch(true)}
                className="w-full px-4 py-2 text-xs font-medium text-bark-600 bg-bark-50 hover:bg-bark-100 rounded-[var(--radius-btn)] transition-colors"
              >
                Branch Story
              </button>
            )}
            <button
              onClick={() => setShowDelete(true)}
              className="w-full px-4 py-2 text-xs font-medium text-red-600 bg-white border border-red-200 hover:bg-red-50 rounded-[var(--radius-btn)] transition-colors"
            >
              Delete Story
            </button>
          </div>
        </div>
      </div>

      {/* Dialogs */}
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

function DownloadLink({ href, label, description }: {
  href: string;
  label: string;
  description: string;
}) {
  return (
    <a
      href={href}
      download
      className="flex items-center gap-3 p-3 rounded-xl bg-cream hover:bg-cream-dark transition-colors group"
    >
      <div>
        <div className="text-sm font-semibold text-bark-700 group-hover:text-sage-700 transition-colors">{label}</div>
        <div className="text-[10px] text-bark-400">{description}</div>
      </div>
      <svg className="w-4 h-4 ml-auto text-bark-300 group-hover:text-sage-500 transition-colors" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
      </svg>
    </a>
  );
}
