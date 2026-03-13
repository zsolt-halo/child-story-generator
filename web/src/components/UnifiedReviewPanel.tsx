import { useState, useCallback } from "react";
import { StoryReviewPanel } from "./StoryReviewPanel";
import { CastReviewPanel } from "./CastReviewPanel";
import { FadeImage } from "./FadeImage";
import type { CastMember, CoverVariation } from "../api/types";

interface UnifiedReviewPanelProps {
  slug: string;
  title: string;
  castMembers: CastMember[];
  castRefUrls: Record<string, string>;
  mainRefSheetUrl: string | null;
  coverVariations: CoverVariation[];
  onApprove: (choice: number, castEdited: boolean, cast: CastMember[]) => void;
  approving?: boolean;
}

type SectionKey = "story" | "cast" | "cover";

export function UnifiedReviewPanel({
  slug,
  title,
  castMembers,
  castRefUrls,
  mainRefSheetUrl,
  coverVariations,
  onApprove,
  approving,
}: UnifiedReviewPanelProps) {
  const [expanded, setExpanded] = useState<Record<SectionKey, boolean>>({
    story: false,
    cast: false,
    cover: true,
  });
  const [chosen, setChosen] = useState<number | null>(null);
  const [editedCast, setEditedCast] = useState<CastMember[] | null>(null);
  const [castEdited, setCastEdited] = useState(false);

  const toggle = (key: SectionKey) => {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleCastUpdate = useCallback((cast: CastMember[]) => {
    setEditedCast(cast);
    setCastEdited(true);
  }, []);

  const handleApprove = () => {
    if (!chosen) return;
    onApprove(chosen, castEdited, editedCast ?? castMembers);
  };


  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-white rounded-[var(--radius-card)] border border-bark-100 p-6 shadow-sm">
        <h2 className="text-xl font-bold text-bark-800 font-[family-name:var(--font-heading)]">
          Your Story is Ready for Review
        </h2>
        <p className="text-sm text-bark-400 mt-1">
          Review your story, characters, and cover before we paint every page.
        </p>
      </div>

      {/* Section 1: Story Flow */}
      <AccordionSection
        title="Story Flow"
        subtitle={`"${title}"`}
        expanded={expanded.story}
        onToggle={() => toggle("story")}
        icon={
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
          </svg>
        }
        badge={<span className="text-[10px] text-sage-600 font-medium">Looks good</span>}
      >
        <StoryReviewPanel
          slug={slug}
          onApprove={() => {/* no-op — approve handled at bottom */}}
          approving={false}
          hideApproveButton
        />
      </AccordionSection>

      {/* Section 2: Characters */}
      {castMembers.length > 0 && (
        <AccordionSection
          title="Characters"
          subtitle={`${castMembers.length} cast member${castMembers.length !== 1 ? "s" : ""}`}
          expanded={expanded.cast}
          onToggle={() => toggle("cast")}
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0112.75 0v.109zM12 9.75a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
            </svg>
          }
          badge={
            castEdited
              ? <span className="text-[10px] text-amber-600 font-medium">Edited</span>
              : <span className="text-[10px] text-sage-600 font-medium">Looks good</span>
          }
        >
          {/* Collapsed preview: horizontal scroll of ref sheet thumbnails */}
          {!expanded.cast && (
            <div className="flex gap-3 overflow-x-auto pb-2 px-1 -mx-1">
              {castMembers.map((m) => {
                const refUrl = castRefUrls[m.name];
                return (
                  <div key={m.name} className="shrink-0 w-20 text-center">
                    <div className="w-20 h-20 rounded-lg overflow-hidden bg-bark-100 border border-bark-200/60">
                      {refUrl ? (
                        <FadeImage src={refUrl} thumbWidth={100} alt={m.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-bark-300 text-xs font-bold">
                          {m.name[0]}
                        </div>
                      )}
                    </div>
                    <p className="text-[10px] text-bark-500 mt-1 truncate">{m.name}</p>
                  </div>
                );
              })}
            </div>
          )}
          {/* Expanded: full cast editor */}
          {expanded.cast && (
            <CastReviewPanel
              slug={slug}
              initialCast={castMembers}
              castRefUrls={castRefUrls}
              mainRefSheetUrl={mainRefSheetUrl}
              onApprove={handleCastUpdate}
              approving={false}
            />
          )}
        </AccordionSection>
      )}

      {/* Section 3: Cover Selection */}
      <AccordionSection
        title="Cover"
        subtitle={chosen ? `Option ${chosen} selected` : "Pick your favorite"}
        expanded={expanded.cover}
        onToggle={() => toggle("cover")}
        icon={
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
          </svg>
        }
        badge={
          chosen
            ? <span className="text-[10px] text-sage-600 font-medium">Selected</span>
            : <span className="text-[10px] text-amber-600 font-medium">Choose one</span>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          {coverVariations.map((v) => (
            <button
              key={v.index}
              onClick={() => setChosen(v.index)}
              disabled={approving}
              className={`relative aspect-square rounded-xl overflow-hidden border-3 transition-all ${
                chosen === v.index
                  ? "border-sage-400 ring-2 ring-sage-400/30 scale-[1.02]"
                  : "border-bark-100 hover:border-bark-200"
              } ${approving ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
            >
              <FadeImage
                src={v.url}
                thumbWidth={600}
                alt={`Cover option ${v.index}`}
                className="w-full h-full object-cover"
              />
              <div className={`absolute top-2 left-2 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                chosen === v.index
                  ? "bg-sage-400 text-white"
                  : "bg-black/40 text-white"
              }`}>
                Option {v.index}
              </div>
              {chosen === v.index && (
                <div className="absolute inset-0 bg-sage-400/10 flex items-center justify-center">
                  <div className="w-10 h-10 rounded-full bg-sage-500 flex items-center justify-center">
                    <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  </div>
                </div>
              )}
            </button>
          ))}
        </div>
      </AccordionSection>

      {/* Approve button */}
      <div className="bg-white rounded-[var(--radius-card)] border border-bark-100 shadow-sm p-5">
        <div className="flex items-center justify-between">
          <p className="text-sm text-bark-500">
            {!chosen
              ? "Select a cover to continue"
              : "Ready to illustrate every page!"}
          </p>
          <button
            onClick={handleApprove}
            disabled={!chosen || approving}
            className="px-8 py-3 text-sm font-bold text-white bg-sage-600 hover:bg-sage-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-[var(--radius-btn)] transition-colors active:scale-[0.97]"
          >
            {approving ? "Starting..." : "Looks Great — Illustrate!"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Accordion Section ────────────────────────────────────────────────

function AccordionSection({
  title,
  subtitle,
  expanded,
  onToggle,
  icon,
  badge,
  children,
}: {
  title: string;
  subtitle: string;
  expanded: boolean;
  onToggle: () => void;
  icon: React.ReactNode;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-[var(--radius-card)] border border-bark-100 shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-4 px-6 py-4 text-left hover:bg-bark-50/50 transition-colors"
      >
        <div className="text-bark-400">{icon}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-bold text-bark-800">{title}</span>
            {badge}
          </div>
          <p className="text-xs text-bark-400 mt-0.5 truncate">{subtitle}</p>
        </div>
        <svg
          className={`w-5 h-5 text-bark-300 shrink-0 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      {expanded && (
        <div className="border-t border-bark-100 p-6">
          {children}
        </div>
      )}
    </div>
  );
}
