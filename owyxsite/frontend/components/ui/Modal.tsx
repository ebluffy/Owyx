"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type ModalProps = {
  open?: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  /** Wider dialog (default max-w-md). */
  size?: "sm" | "md" | "lg";
  /** Extra class on the dialog panel. */
  panelClassName?: string;
};

const SIZE = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-xl",
} as const;

/**
 * Full-viewport modal: portals to document.body, locks scroll, sits above
 * header/particles (z-[200]), dark scrim so it never looks “behind” the page.
 */
export default function Modal({
  open = true,
  onClose,
  title,
  description,
  children,
  size = "md",
  panelClassName = "",
}: ModalProps) {
  const titleId = useId();
  const descId = useId();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open || !mounted) return;

    const prevOverflow = document.body.style.overflow;
    const prevPadding = document.body.style.paddingRight;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (scrollbar > 0) {
      document.body.style.paddingRight = `${scrollbar}px`;
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);

    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.paddingRight = prevPadding;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, mounted, onClose]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-6"
      role="presentation"
    >
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 cursor-default border-0 bg-black/80"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        className={`relative z-10 w-full ${SIZE[size]} max-h-[min(92vh,40rem)] overflow-y-auto rounded-2xl border border-line bg-panel p-5 sm:p-6 shadow-[0_24px_80px_-20px_rgba(0,0,0,0.85)] fade-up ${panelClassName}`}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="font-display text-lg font-bold tracking-tight text-text">
          {title}
        </h2>
        {description && (
          <p id={descId} className="mt-1.5 text-sm leading-relaxed text-muted">
            {description}
          </p>
        )}
        <div className={description || title ? "mt-5" : ""}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}
