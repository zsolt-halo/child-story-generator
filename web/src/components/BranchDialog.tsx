import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getCharacters, getStyles, getNarrators } from "../api/client";
import { PickerCard } from "./PickerCard";
import type { StoryMetadata, BranchRequest } from "../api/types";

const STYLE_ICONS: Record<string, string> = {
  digital: "🎨",
  watercolor: "🖌️",
  ghibli: "🏯",
  papercut: "✂️",
};

const NARRATOR_ICONS: Record<string, string> = {
  whimsical: "🎪",
  bedtime: "🌙",
  heroic: "⚔️",
};

interface BranchDialogProps {
  open: boolean;
  onClose: () => void;
  onBranch: (req: BranchRequest) => void;
  metadata: StoryMetadata;
  sourceTitle: string;
  branching?: boolean;
}

export function BranchDialog({ open, onClose, onBranch, metadata, sourceTitle, branching }: BranchDialogProps) {
  const cfg = metadata.config;
  const [character, setCharacter] = useState(cfg.character);
  const [style, setStyle] = useState(cfg.style);
  const [narrator, setNarrator] = useState(cfg.narrator);
  const [pages, setPages] = useState(cfg.pages);
  const [language, setLanguage] = useState(cfg.language || "");
  const [startFrom, setStartFrom] = useState<"full" | "illustration">("full");

  const { data: characters } = useQuery({ queryKey: ["characters"], queryFn: getCharacters });
  const { data: styles } = useQuery({ queryKey: ["styles"], queryFn: getStyles });
  const { data: narrators } = useQuery({ queryKey: ["narrators"], queryFn: getNarrators });

  if (!open) return null;

  const handleSubmit = () => {
    onBranch({
      character,
      narrator,
      style,
      pages,
      language: language || undefined,
      start_from: startFrom,
    });
  };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-bark-900/40 backdrop-blur-sm z-40" onClick={onClose} />

      {/* Dialog */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl max-h-[85vh] overflow-y-auto">
          <div className="px-6 py-5 border-b border-bark-100">
            <h2 className="text-lg font-bold text-bark-800">Branch Story</h2>
            <p className="text-sm text-bark-400 mt-0.5">
              Create a variant of <span className="font-medium text-bark-600">"{sourceTitle}"</span>
            </p>
          </div>

          <div className="px-6 py-5 space-y-5">
            {/* Starting point */}
            <div>
              <span className="text-xs font-semibold text-bark-500 uppercase tracking-wide">Starting Point</span>
              <div className="grid grid-cols-2 gap-3 mt-2">
                <button
                  onClick={() => setStartFrom("full")}
                  className={`p-3 rounded-xl border text-left text-sm transition-colors ${
                    startFrom === "full"
                      ? "border-amber-400 bg-amber-50"
                      : "border-bark-200 bg-white hover:bg-bark-50"
                  }`}
                >
                  <span className="font-semibold text-bark-800 block">Re-generate everything</span>
                  <span className="text-xs text-bark-400">New story, new illustrations</span>
                </button>
                <button
                  onClick={() => setStartFrom("illustration")}
                  className={`p-3 rounded-xl border text-left text-sm transition-colors ${
                    startFrom === "illustration"
                      ? "border-amber-400 bg-amber-50"
                      : "border-bark-200 bg-white hover:bg-bark-50"
                  }`}
                >
                  <span className="font-semibold text-bark-800 block">Keep story, re-illustrate</span>
                  <span className="text-xs text-bark-400">Same text, new art style</span>
                </button>
              </div>
            </div>

            {/* Character */}
            <div>
              <span className="text-xs font-semibold text-bark-500 uppercase tracking-wide">Character</span>
              <div className="grid grid-cols-1 gap-2 mt-2">
                {characters?.map((c) => (
                  <PickerCard
                    key={c.slug}
                    selected={character === c.slug}
                    onClick={() => setCharacter(c.slug)}
                    title={c.name}
                    subtitle={`for ${c.child_name}`}
                    description={c.description}
                  />
                ))}
              </div>
            </div>

            {/* Style */}
            <div>
              <span className="text-xs font-semibold text-bark-500 uppercase tracking-wide">Art Style</span>
              <div className="grid grid-cols-2 gap-2 mt-2">
                {styles?.map((s) => (
                  <PickerCard
                    key={s.name}
                    selected={style === s.name}
                    onClick={() => setStyle(s.name)}
                    title={s.name.charAt(0).toUpperCase() + s.name.slice(1)}
                    description={s.description}
                    icon={<span>{STYLE_ICONS[s.name] || "🎨"}</span>}
                  />
                ))}
              </div>
            </div>

            {/* Narrator */}
            <div>
              <span className="text-xs font-semibold text-bark-500 uppercase tracking-wide">Narrator Voice</span>
              <div className="grid grid-cols-1 gap-2 mt-2">
                {narrators?.map((n) => (
                  <PickerCard
                    key={n.slug}
                    selected={narrator === n.slug}
                    onClick={() => setNarrator(n.slug)}
                    title={n.name}
                    description={n.example}
                    icon={<span>{NARRATOR_ICONS[n.slug] || "📖"}</span>}
                  />
                ))}
              </div>
            </div>

            {/* Pages */}
            <label className="block">
              <span className="text-xs font-semibold text-bark-500 uppercase tracking-wide">Pages</span>
              <input
                type="range"
                min={8}
                max={24}
                step={2}
                value={pages}
                onChange={(e) => setPages(Number(e.target.value))}
                className="mt-2 w-full accent-amber-500"
              />
              <div className="flex justify-between text-xs text-bark-400 mt-1">
                <span>8</span>
                <span className="font-semibold text-amber-700">{pages} pages</span>
                <span>24</span>
              </div>
            </label>

            {/* Language */}
            <label className="block">
              <span className="text-xs font-semibold text-bark-500 uppercase tracking-wide">Translation Language</span>
              <input
                type="text"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                placeholder="e.g., hungarian, german, french"
                className="mt-1.5 w-full px-3 py-2.5 bg-cream border border-bark-200 rounded-[var(--radius-btn)] text-sm text-bark-800 placeholder:text-bark-300 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400"
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
              onClick={handleSubmit}
              disabled={branching}
              className="flex-1 py-2.5 text-sm font-semibold text-white bg-sage-600 hover:bg-sage-700 disabled:opacity-60 disabled:cursor-not-allowed rounded-[var(--radius-btn)] transition-colors"
            >
              {branching ? "Creating..." : "Create Branch"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
