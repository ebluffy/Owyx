"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Viewport toast (portaled to body). Parent `transform` / `fade-up` must not
 * trap `position: fixed` — otherwise the toast sticks to the page bottom.
 */
export function Toast({
  text,
  type,
  onDismiss,
  durationMs = 3200,
}: {
  text: string;
  type: "success" | "error";
  onDismiss?: () => void;
  durationMs?: number;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!onDismiss || durationMs <= 0) return;
    const id = window.setTimeout(onDismiss, durationMs);
    return () => window.clearTimeout(id);
  }, [onDismiss, durationMs, text]);

  if (!mounted) return null;

  return createPortal(
    <div
      role="status"
      className={`fixed bottom-5 left-1/2 z-[220] max-w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 rounded-[10px] border px-4 py-3 text-sm shadow-lg fade-up ${
        type === "success" ? "form-msg-ok" : "form-msg-err"
      }`}
    >
      {text}
    </div>,
    document.body,
  );
}
