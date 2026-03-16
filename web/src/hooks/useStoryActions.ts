import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { startAnimate, startIllustrate, startIllustratePage, startTranslate } from "../api/client";
import { usePipelineStore } from "../stores/pipelineStore";

interface StoryActions {
  handleAnimate: () => Promise<void>;
  handleIllustrate: () => Promise<void>;
  handleRegenerate: (pageNumber: number) => Promise<void>;
  handleTranslate: (language: string) => Promise<void>;
  animating: boolean;
  translating: boolean;
}

export function useStoryActions(slug: string, invalidate?: () => void): StoryActions {
  const navigate = useNavigate();
  const setTaskId = usePipelineStore((s) => s.setTaskId);
  const [animating, setAnimating] = useState(false);
  const [translating, setTranslating] = useState(false);

  const handleAnimate = useCallback(async () => {
    setAnimating(true);
    try {
      const res = await startAnimate(slug);
      setTaskId(res.task_id);
      navigate(`/stories/${slug}/pipeline`, { state: { taskId: res.task_id } });
    } catch (err) {
      console.error("Failed to start animation:", err);
      setAnimating(false);
    }
  }, [slug, setTaskId, navigate]);

  const handleIllustrate = useCallback(async () => {
    const res = await startIllustrate(slug);
    setTaskId(res.task_id);
  }, [slug, setTaskId]);

  const handleRegenerate = useCallback(async (pageNumber: number) => {
    const res = await startIllustratePage(slug, pageNumber);
    setTaskId(res.task_id);
  }, [slug, setTaskId]);

  const handleTranslate = useCallback(async (language: string) => {
    if (!language.trim()) return;
    setTranslating(true);
    try {
      await startTranslate(slug, language.trim());
      invalidate?.();
    } finally {
      setTranslating(false);
    }
  }, [slug, invalidate]);

  return { handleAnimate, handleIllustrate, handleRegenerate, handleTranslate, animating, translating };
}
