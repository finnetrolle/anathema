import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import type { TimelineModel, TimelineRowItem } from "@/modules/timeline/types";
import {
  buildCenteredPopoverStyle,
  clamp,
} from "@/components/timeline/timeline-copy";

export type SelectedTask = {
  anchorTaskId: string;
  epicKey: string;
  epicSummary: string;
  item: TimelineRowItem;
};

const POPOVER_MARGIN = 16;
const POPOVER_GAP = 12;
const CENTER_POPOVER_BREAKPOINT = 1180;

export function useTaskSelection(visibleRows: TimelineModel["rows"]) {
  const [selectedTask, setSelectedTask] = useState<SelectedTask | null>(null);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>(
    buildCenteredPopoverStyle(),
  );
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!selectedTask) {
      return undefined;
    }

    const anchorSelector = `[data-task-trigger="${selectedTask.anchorTaskId}"]`;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedTask(null);
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;

      if (!(target instanceof Node)) {
        return;
      }

      if (popoverRef.current?.contains(target)) {
        return;
      }

      const anchor = document.querySelector(anchorSelector);

      if (anchor instanceof Node && anchor.contains(target)) {
        return;
      }

      setSelectedTask(null);
    };

    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [selectedTask]);

  useEffect(() => {
    if (!selectedTask) {
      return undefined;
    }

    const isTaskVisible = visibleRows.some((row) =>
      row.items.some((item) => item.issueId === selectedTask.item.issueId),
    );

    if (!isTaskVisible) {
      const frame = window.requestAnimationFrame(() => {
        setSelectedTask(null);
      });

      return () => {
        window.cancelAnimationFrame(frame);
      };
    }

    return undefined;
  }, [selectedTask, visibleRows]);

  useLayoutEffect(() => {
    if (!selectedTask || !popoverRef.current) {
      return undefined;
    }

    const updatePosition = () => {
      if (!popoverRef.current) {
        return;
      }

      const anchor = document.querySelector(
        `[data-task-trigger="${selectedTask.anchorTaskId}"]`,
      );
      const popoverRect = popoverRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      if (!(anchor instanceof HTMLElement) || viewportWidth < CENTER_POPOVER_BREAKPOINT) {
        setPopoverStyle(buildCenteredPopoverStyle());
        return;
      }

      const anchorRect = anchor.getBoundingClientRect();
      const maxLeft = viewportWidth - popoverRect.width - POPOVER_MARGIN;
      const maxTop = viewportHeight - popoverRect.height - POPOVER_MARGIN;
      let left = anchorRect.right + POPOVER_GAP;
      let top = anchorRect.top;

      if (left > maxLeft) {
        left = anchorRect.left - popoverRect.width - POPOVER_GAP;
      }

      if (left < POPOVER_MARGIN) {
        left = clamp(anchorRect.left, POPOVER_MARGIN, maxLeft);
        top = anchorRect.bottom + POPOVER_GAP;
      }

      if (top > maxTop) {
        top = anchorRect.bottom - popoverRect.height;
      }

      if (top < POPOVER_MARGIN) {
        top = clamp(anchorRect.top, POPOVER_MARGIN, maxTop);
      }

      setPopoverStyle({
        left: `${clamp(left, POPOVER_MARGIN, maxLeft)}px`,
        top: `${clamp(top, POPOVER_MARGIN, maxTop)}px`,
      });
    };

    updatePosition();

    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [selectedTask]);

  return { selectedTask, setSelectedTask, popoverRef, popoverStyle };
}
