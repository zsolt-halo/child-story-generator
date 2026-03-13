import { useState, useEffect, useMemo, useCallback } from "react";
import type { Keyframe } from "../api/types";

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

export function useRenderSnapshot(
  slug: string | undefined,
  keyframes: Keyframe[] | undefined,
  hasPdf: boolean,
) {
  const [renderSnapshot, setRenderSnapshot] = useState<TextSnapshot | null>(null);

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
    if (!keyframes || !slug || !hasPdf) return;
    if (renderSnapshot !== null) return;
    const snap = buildSnapshot(keyframes);
    setRenderSnapshot(snap);
    localStorage.setItem(snapshotKey(slug), JSON.stringify(snap));
  }, [keyframes, slug, hasPdf, renderSnapshot]);

  // Compute pages with text changes since last render
  const modifiedPages = useMemo(() => {
    if (!renderSnapshot || !keyframes) return new Set<number>();
    const modified = new Set<number>();
    for (const kf of keyframes) {
      const snap = renderSnapshot[kf.page_number];
      if (!snap) { modified.add(kf.page_number); continue; }
      if (kf.page_text !== snap.text || (kf.page_text_translated ?? null) !== snap.translated) {
        modified.add(kf.page_number);
      }
    }
    return modified;
  }, [keyframes, renderSnapshot]);

  const saveSnapshot = useCallback(() => {
    if (!slug || !keyframes) return;
    const snap = buildSnapshot(keyframes);
    setRenderSnapshot(snap);
    localStorage.setItem(snapshotKey(slug), JSON.stringify(snap));
  }, [slug, keyframes]);

  return {
    modifiedPages,
    modifiedCount: modifiedPages.size,
    saveSnapshot,
  };
}
