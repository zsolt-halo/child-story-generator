import { useEffect, useRef } from "react";
import type { SSEEvent } from "../api/types";

export function useSSE(
  taskId: string | null,
  basePath: "/api/pipeline/progress" | "/api/sanity/progress",
  onEvent: (event: SSEEvent) => void,
) {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!taskId) return;

    const source = new EventSource(`${basePath}/${taskId}`);

    source.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as SSEEvent;
        onEventRef.current(data);
        if (data.type === "task_complete" || data.type === "error") {
          source.close();
        }
      } catch {
        // Ignore parse errors
      }
    };

    source.onerror = () => {
      source.close();
    };

    return () => {
      source.close();
    };
  }, [taskId, basePath]);
}
