import { useState, useEffect, useCallback, useRef } from "react";
import { FadeImage } from "./FadeImage";
import { updateStory, regenerateCastRefSheet } from "../api/client";
import type { CastMember } from "../api/types";

interface CastReviewPanelProps {
  slug: string;
  initialCast: CastMember[];
  castRefUrls: Record<string, string>;
  mainRefSheetUrl: string | null;
  onApprove: (cast: CastMember[]) => void;
  approving?: boolean;
  /** Override the default "Approve & Continue" button labels */
  submitLabel?: string;
  submittingLabel?: string;
}

const emptyCastMember: CastMember = {
  name: "",
  role: "",
  species: "",
  visual_description: "",
  visual_constants: "",
  appears_on_pages: [],
};

export function CastReviewPanel({
  slug,
  initialCast,
  castRefUrls,
  mainRefSheetUrl,
  onApprove,
  approving,
  submitLabel = "Approve & Continue",
  submittingLabel = "Continuing...",
}: CastReviewPanelProps) {
  const [cast, setCast] = useState<CastMember[]>([]);
  const [regenerating, setRegenerating] = useState<Record<string, boolean>>({});
  const [localRefUrls, setLocalRefUrls] = useState<Record<string, string>>({});
  // Track which members had visual fields edited since their ref sheet was generated
  const [dirtyVisuals, setDirtyVisuals] = useState<Record<string, boolean>>({});
  const [expandedCards, setExpandedCards] = useState<Record<number, boolean>>({});
  // Track thumbs-down feedback mode per card (shows textarea + regenerate)
  const [feedbackMode, setFeedbackMode] = useState<Record<number, boolean>>({});
  // Track feedback text per card
  const [feedbackText, setFeedbackText] = useState<Record<number, string>>({});
  const eventSourcesRef = useRef<Map<string, EventSource>>(new Map());

  useEffect(() => {
    setCast(initialCast.map((c) => ({ ...c })));
    // Expand all cards by default
    const expanded: Record<number, boolean> = {};
    initialCast.forEach((_, i) => { expanded[i] = true; });
    setExpandedCards(expanded);
  }, [initialCast]);

  // Clean up EventSources on unmount
  useEffect(() => {
    return () => {
      for (const es of eventSourcesRef.current.values()) {
        es.close();
      }
    };
  }, []);

  const toggleCard = (idx: number) => {
    setExpandedCards((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  const collapseCard = (idx: number) => {
    setExpandedCards((prev) => ({ ...prev, [idx]: false }));
  };

  const openFeedback = (idx: number) => {
    setFeedbackMode((prev) => ({ ...prev, [idx]: true }));
  };

  const updateMember = (idx: number, field: keyof CastMember, value: unknown) => {
    setCast((prev) => prev.map((m, i) => (i === idx ? { ...m, [field]: value } : m)));
    // Track visual edits for dirty detection
    if (field === "visual_description" || field === "visual_constants") {
      const memberName = cast[idx]?.name;
      if (memberName) {
        setDirtyVisuals((prev) => ({ ...prev, [memberName]: true }));
      }
    }
  };

  const removeMember = (idx: number) => {
    setCast((prev) => prev.filter((_, i) => i !== idx));
  };

  const addMember = () => {
    const newIdx = cast.length;
    setCast((prev) => [...prev, { ...emptyCastMember }]);
    setExpandedCards((prev) => ({ ...prev, [newIdx]: true }));
  };

  // Get the effective ref URL for a member (local override > prop from store)
  const getRefUrl = useCallback(
    (memberName: string): string | null => {
      return localRefUrls[memberName] || castRefUrls[memberName] || null;
    },
    [localRefUrls, castRefUrls],
  );

  const handleRegenerate = useCallback(
    async (memberName: string) => {
      if (regenerating[memberName]) return;
      setRegenerating((prev) => ({ ...prev, [memberName]: true }));
      try {
        // Save current cast to backend first so regeneration uses latest descriptions
        await updateStory(slug, { cast });
        const { task_id } = await regenerateCastRefSheet(slug, memberName);

        // Open one-off SSE to track this task
        const source = new EventSource(`/api/pipeline/progress/${task_id}`);
        eventSourcesRef.current.set(memberName, source);

        source.onmessage = (e) => {
          const event = JSON.parse(e.data);
          if (event.type === "cast_ref_complete" && event.url) {
            setLocalRefUrls((prev) => ({
              ...prev,
              [memberName]: event.url + `?t=${Date.now()}`,
            }));
            setDirtyVisuals((prev) => ({ ...prev, [memberName]: false }));
          }
          if (event.type === "task_complete" || event.type === "error") {
            source.close();
            eventSourcesRef.current.delete(memberName);
            setRegenerating((prev) => ({ ...prev, [memberName]: false }));
          }
        };
        source.onerror = () => {
          source.close();
          eventSourcesRef.current.delete(memberName);
          setRegenerating((prev) => ({ ...prev, [memberName]: false }));
        };
      } catch {
        setRegenerating((prev) => ({ ...prev, [memberName]: false }));
      }
    },
    [regenerating, slug, cast],
  );

  const handleFeedbackRegenerate = useCallback(
    async (idx: number, memberName: string) => {
      if (regenerating[memberName]) return;

      const feedback = feedbackText[idx]?.trim();
      // Build updated cast with feedback appended to visual_description
      const updatedCast = feedback
        ? cast.map((m, i) =>
            i === idx
              ? { ...m, visual_description: m.visual_description + `\n[Feedback: ${feedback}]` }
              : m,
          )
        : cast;

      if (feedback) {
        setCast(updatedCast);
        if (cast[idx]?.name) {
          setDirtyVisuals((prev) => ({ ...prev, [cast[idx].name]: true }));
        }
      }

      // Clear feedback state
      setFeedbackMode((prev) => ({ ...prev, [idx]: false }));
      setFeedbackText((prev) => ({ ...prev, [idx]: "" }));

      // Save updated cast and trigger regeneration directly (not via handleRegenerate,
      // which would close over stale cast state)
      setRegenerating((prev) => ({ ...prev, [memberName]: true }));
      try {
        await updateStory(slug, { cast: updatedCast });
        const { task_id } = await regenerateCastRefSheet(slug, memberName);

        const source = new EventSource(`/api/pipeline/progress/${task_id}`);
        eventSourcesRef.current.set(memberName, source);

        source.onmessage = (e) => {
          const event = JSON.parse(e.data);
          if (event.type === "cast_ref_complete" && event.url) {
            setLocalRefUrls((prev) => ({
              ...prev,
              [memberName]: event.url + `?t=${Date.now()}`,
            }));
            setDirtyVisuals((prev) => ({ ...prev, [memberName]: false }));
          }
          if (event.type === "task_complete" || event.type === "error") {
            source.close();
            eventSourcesRef.current.delete(memberName);
            setRegenerating((prev) => ({ ...prev, [memberName]: false }));
          }
        };
        source.onerror = () => {
          source.close();
          eventSourcesRef.current.delete(memberName);
          setRegenerating((prev) => ({ ...prev, [memberName]: false }));
        };
      } catch {
        setRegenerating((prev) => ({ ...prev, [memberName]: false }));
      }
    },
    [feedbackText, cast, regenerating, slug],
  );

  const inputCls =
    "mt-1 w-full px-3 py-2 bg-white border border-bark-200 rounded-[var(--radius-btn)] text-sm text-bark-800 focus:outline-none focus:border-sage-400 focus:ring-1 focus:ring-sage-400";
  const labelCls = "text-[11px] font-semibold text-bark-500 uppercase tracking-wide";

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="bg-white rounded-[var(--radius-card)] border border-bark-100 p-6 shadow-sm">
        <h2 className="text-lg font-bold text-bark-800">Cast Review</h2>
        <p className="text-sm text-bark-400 mt-1">
          Review character descriptions and reference sheets before illustration begins.
          Edit visuals and regenerate reference sheets to get the look just right.
        </p>
      </div>

      {/* Main character reference sheet — hero treatment */}
      {mainRefSheetUrl && (
        <div className="bg-white rounded-[var(--radius-card)] border border-bark-100 shadow-sm overflow-hidden">
          <div className="bg-gradient-to-r from-amber-50 to-amber-100/50 px-6 py-3 border-b border-amber-200/40">
            <span className="text-[11px] font-bold text-amber-600 uppercase tracking-wider">
              Protagonist Reference Sheet
            </span>
          </div>
          <div className="p-6">
            <div className="flex gap-6 items-start">
              <div className="w-56 shrink-0 rounded-xl overflow-hidden border border-amber-200/60 shadow-sm bg-white">
                <FadeImage
                  src={mainRefSheetUrl}
                  thumbWidth={400}
                  alt="Main character reference"
                  className="w-full h-auto"
                />
              </div>
              <div className="pt-2 flex-1 min-w-0">
                <p className="text-sm text-bark-500 leading-relaxed">
                  This multi-pose reference sheet guides all illustrations for the protagonist,
                  ensuring consistent appearance across every page.
                </p>
                <p className="text-sm text-bark-500 leading-relaxed mt-2">
                  The cast member sheets below do the same for secondary characters.
                  Review each one and regenerate any that don't look right.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cast member cards — one card per character */}
      {cast.map((member, idx) => {
        const refUrl = getRefUrl(member.name);
        const isRegenerating = regenerating[member.name] ?? false;
        const isDirty = dirtyVisuals[member.name] ?? false;
        const isExpanded = expandedCards[idx] ?? false;
        const isFeedbackOpen = feedbackMode[idx] ?? false;

        return (
          <div
            key={idx}
            className="bg-white rounded-[var(--radius-card)] border border-bark-100 shadow-sm overflow-hidden cast-card-enter"
            style={{ animationDelay: `${idx * 0.06}s` }}
          >
            {/* Card header — always visible, acts as collapse toggle */}
            <button
              type="button"
              onClick={() => toggleCard(idx)}
              className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-bark-50/50 transition-colors"
            >
              {/* Small thumbnail */}
              <div className="w-12 h-12 shrink-0 rounded-lg overflow-hidden bg-bark-100 border border-bark-200/60">
                {isRegenerating ? (
                  <div className="w-full h-full flex items-center justify-center">
                    <div className="w-5 h-5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : refUrl ? (
                  <FadeImage
                    src={refUrl}
                    thumbWidth={100}
                    alt={member.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-bark-300">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0" />
                    </svg>
                  </div>
                )}
              </div>

              {/* Identity */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-bark-800 truncate">
                    {member.name || "Unnamed character"}
                  </span>
                  {isDirty && !isRegenerating && refUrl && (
                    <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-semibold">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                      </svg>
                      Visuals changed
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  {member.role && (
                    <span className="text-xs text-bark-400">{member.role}</span>
                  )}
                  {member.role && member.species && (
                    <span className="text-bark-300">&middot;</span>
                  )}
                  {member.species && (
                    <span className="text-xs text-bark-400">{member.species}</span>
                  )}
                  {member.appears_on_pages.length > 0 && (
                    <>
                      <span className="text-bark-300">&middot;</span>
                      <span className="text-xs text-bark-300">
                        {member.appears_on_pages.length === 1
                          ? "1 page"
                          : `${member.appears_on_pages.length} pages`}
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* Chevron */}
              <svg
                className={`w-5 h-5 text-bark-300 shrink-0 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
              </svg>
            </button>

            {/* Expandable body */}
            {isExpanded && (
              <div className="border-t border-bark-100 cast-card-body-enter">
                {/* Reference sheet image — full-width, prominent */}
                <div className="p-5 bg-cream/50">
                  <div className="relative rounded-xl overflow-hidden bg-bark-100 border border-bark-200/60 shadow-sm">
                    <div className="aspect-square max-w-md mx-auto">
                      {isRegenerating ? (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-bark-50">
                          <div className="w-10 h-10 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
                          <span className="text-xs text-bark-400 mt-3 font-medium">Generating sheet...</span>
                        </div>
                      ) : refUrl ? (
                        <FadeImage
                          src={refUrl}
                          thumbWidth={600}
                          alt={`${member.name} reference sheet`}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-bark-300">
                          <svg className="w-10 h-10 mb-2" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
                          </svg>
                          <span className="text-[10px] font-medium">No reference sheet yet</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Thumbs up / thumbs down quick feedback row */}
                  {refUrl && !isRegenerating && (
                    <div className="mt-4 flex items-center justify-center gap-3">
                      {/* Thumbs up — looks good, collapse */}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); collapseCard(idx); }}
                        className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-sage-700 bg-sage-50 border border-sage-200 hover:bg-sage-100 rounded-[var(--radius-btn)] transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6.633 10.25c.806 0 1.533-.446 2.031-1.08a9.041 9.041 0 0 1 2.861-2.4c.723-.384 1.35-.956 1.653-1.715a4.498 4.498 0 0 0 .322-1.672V3a.75.75 0 0 1 .75-.75 2.25 2.25 0 0 1 2.25 2.25c0 1.152-.26 2.243-.723 3.218-.266.558.107 1.282.725 1.282h3.126c1.026 0 1.945.694 2.054 1.715.045.422.068.85.068 1.285a11.95 11.95 0 0 1-2.649 7.521c-.388.482-.987.729-1.605.729H14.23c-.483 0-.964-.078-1.423-.23l-3.114-1.04a4.501 4.501 0 0 0-1.423-.23H5.904m.729-6.33A2.25 2.25 0 0 0 4.5 9.897v5.955a2.25 2.25 0 0 0 1.633 2.163l.104.031c.572.17 1.12.41 1.617.718a9.082 9.082 0 0 0 3.396 1.236" />
                        </svg>
                        Looks good
                      </button>

                      {/* Thumbs down — needs changes */}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); openFeedback(idx); }}
                        className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-[var(--radius-btn)] transition-colors ${
                          isFeedbackOpen
                            ? "text-amber-700 bg-amber-100 border border-amber-300"
                            : "text-bark-500 bg-white border border-bark-200 hover:border-amber-400 hover:text-amber-700"
                        }`}
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M7.498 15.25H4.372c-1.026 0-1.945-.694-2.054-1.715A12.137 12.137 0 0 1 2.25 12c0-2.848.992-5.464 2.649-7.521C5.287 3.997 5.886 3.75 6.504 3.75h4.369a4.5 4.5 0 0 1 1.423.23l3.114 1.04a4.5 4.5 0 0 0 1.423.23h1.294M7.498 15.25c.618 0 1.02.635.726 1.08a9.041 9.041 0 0 0-2.861 2.4c-.723.384-1.35.956-1.653 1.715a4.498 4.498 0 0 0-.322 1.672V21a.75.75 0 0 0 .75.75 2.25 2.25 0 0 0 2.25-2.25c0-1.152.26-2.243.723-3.218.266-.558-.107-1.282-.725-1.282H7.498z" />
                        </svg>
                        Needs changes
                      </button>
                    </div>
                  )}

                  {/* Feedback textarea + regenerate (revealed by thumbs-down) */}
                  {isFeedbackOpen && (
                    <div className="mt-4 space-y-3">
                      <textarea
                        value={feedbackText[idx] ?? ""}
                        onChange={(e) => setFeedbackText((prev) => ({ ...prev, [idx]: e.target.value }))}
                        placeholder="What should change? e.g. 'Make the fur darker' or 'Should be wearing a hat'"
                        rows={3}
                        className={`${inputCls} resize-none`}
                      />
                      <button
                        onClick={(e) => { e.stopPropagation(); handleFeedbackRegenerate(idx, member.name); }}
                        disabled={isRegenerating || approving}
                        className="w-full px-3 py-2.5 text-xs font-semibold rounded-[var(--radius-btn)] transition-all inline-flex items-center justify-center gap-1.5 bg-amber-500 text-white hover:bg-amber-600 shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
                        </svg>
                        Regenerate Sheet
                      </button>
                    </div>
                  )}
                </div>

                {/* Fine-tune details — collapsible disclosure */}
                <div className="px-5 pb-4">
                  <details className="group">
                    <summary className="cursor-pointer select-none py-3 text-xs font-semibold text-bark-500 uppercase tracking-wide flex items-center gap-1.5 hover:text-bark-700 transition-colors">
                      <svg className="w-3.5 h-3.5 transition-transform duration-200 group-open:rotate-90" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                      </svg>
                      Fine-tune details
                    </summary>

                    <div className="space-y-3 pt-1 pb-2">
                      {/* Name / Species */}
                      <div className="flex items-start gap-3">
                        <label className="block flex-1">
                          <span className={labelCls}>Name</span>
                          <input
                            type="text"
                            value={member.name}
                            onChange={(e) => updateMember(idx, "name", e.target.value)}
                            className={inputCls}
                          />
                        </label>
                        <label className="block flex-1">
                          <span className={labelCls}>Species</span>
                          <input
                            type="text"
                            value={member.species}
                            onChange={(e) => updateMember(idx, "species", e.target.value)}
                            className={inputCls}
                          />
                        </label>
                      </div>

                      {/* Role / Pages */}
                      <div className="flex items-start gap-3">
                        <label className="block flex-1">
                          <span className={labelCls}>Role</span>
                          <input
                            type="text"
                            value={member.role}
                            onChange={(e) => updateMember(idx, "role", e.target.value)}
                            className={inputCls}
                          />
                        </label>
                        <div className="block flex-1">
                          <span className={labelCls}>Pages</span>
                          <p className="mt-1 px-3 py-2 text-sm text-bark-600">
                            {member.appears_on_pages.length > 0
                              ? member.appears_on_pages.join(", ")
                              : "None"}
                          </p>
                        </div>
                      </div>

                      <label className="block">
                        <span className={labelCls}>Visual Description</span>
                        <textarea
                          value={member.visual_description}
                          onChange={(e) => updateMember(idx, "visual_description", e.target.value)}
                          rows={3}
                          className={`${inputCls} resize-none`}
                        />
                      </label>

                      <label className="block">
                        <span className={labelCls}>Visual Constants</span>
                        <textarea
                          value={member.visual_constants}
                          onChange={(e) => updateMember(idx, "visual_constants", e.target.value)}
                          rows={2}
                          className={`${inputCls} resize-none`}
                        />
                      </label>

                      {/* Direct regenerate button inside details for power users */}
                      {member.name && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleRegenerate(member.name); }}
                          disabled={isRegenerating || approving}
                          className={`w-full px-3 py-2.5 text-xs font-semibold rounded-[var(--radius-btn)] transition-all inline-flex items-center justify-center gap-1.5 ${
                            isDirty && !isRegenerating
                              ? "bg-amber-500 text-white hover:bg-amber-600 shadow-sm"
                              : "text-bark-600 bg-white border border-bark-200 hover:border-amber-400 hover:text-amber-700"
                          } disabled:opacity-40 disabled:cursor-not-allowed`}
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
                          </svg>
                          {isRegenerating
                            ? "Regenerating..."
                            : isDirty
                              ? "Regenerate (visuals changed)"
                              : "Regenerate Sheet"}
                        </button>
                      )}
                    </div>
                  </details>
                </div>

                {/* Card footer — remove button */}
                <div className="flex justify-end px-5 py-3 border-t border-bark-100">
                  <button
                    onClick={() => removeMember(idx)}
                    className="px-3 py-1.5 text-[11px] font-medium text-bark-400 hover:text-red-600 hover:bg-red-50 rounded-[var(--radius-btn)] transition-colors inline-flex items-center gap-1.5"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                    </svg>
                    Remove Character
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* Footer actions */}
      <div className="bg-white rounded-[var(--radius-card)] border border-bark-100 shadow-sm p-5">
        <div className="flex items-center justify-between">
          <button
            onClick={addMember}
            className="px-4 py-2.5 text-xs font-medium text-bark-600 bg-bark-50 hover:bg-bark-100 rounded-[var(--radius-btn)] transition-colors inline-flex items-center gap-1.5"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Add Cast Member
          </button>
          <button
            onClick={() => onApprove(cast)}
            disabled={approving || Object.values(regenerating).some(Boolean)}
            className="px-6 py-2.5 text-sm font-semibold text-white bg-sage-600 hover:bg-sage-700 disabled:opacity-60 disabled:cursor-not-allowed rounded-[var(--radius-btn)] transition-colors"
          >
            {approving ? submittingLabel : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
