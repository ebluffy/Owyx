"use client";

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { useLocale } from "@/hooks/useLocale";

/** New GitHub issue on the Owyx launcher/site monorepo. */
export const OWYX_SUPPORT_ISSUE_URL =
  "https://github.com/ebluffy/Owyx/issues/new?template=blank&title=%5BSupport%5D%20";

/** Fixed bottom-right support widget (site-wide). */
export default function SupportWidget() {
  const [open, setOpen] = useState(false);
  const { locale } = useLocale();
  const en = locale === "en_US";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="support-fab"
        aria-label={en ? "Open support" : "Открыть поддержку"}
        title={en ? "Support" : "Поддержка"}
      >
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.75}
            d="M4 6.5A2.5 2.5 0 016.5 4h11A2.5 2.5 0 0120 6.5v7A2.5 2.5 0 0117.5 16H8l-4 3.5V6.5z"
          />
        </svg>
      </button>
      {open && <SupportChatPanel onClose={() => setOpen(false)} />}
    </>
  );
}

function SupportChatPanel({ onClose }: { onClose: () => void }) {
  const { locale } = useLocale();
  const en = locale === "en_US";
  const titleId = useId();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[190] sm:inset-auto sm:bottom-6 sm:right-6 sm:w-[22rem]" role="presentation">
      <button
        type="button"
        className="absolute inset-0 border-0 bg-black/50 sm:hidden"
        aria-label={en ? "Close" : "Закрыть"}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="support-chat absolute bottom-0 right-0 flex h-[min(28rem,85vh)] w-full flex-col overflow-hidden rounded-t-2xl border border-line bg-panel shadow-[0_24px_60px_-24px_rgba(0,0,0,0.9)] sm:relative sm:h-[26rem] sm:rounded-2xl fade-up"
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.14em] text-accent/80">
              {en ? "Support" : "Поддержка"}
            </p>
            <h2 id={titleId} className="font-display truncate text-sm font-bold tracking-tight text-text">
              {en ? "Owyx help" : "Помощь Owyx"}
            </h2>
          </div>
          <button type="button" className="btn btn-ghost btn-sm shrink-0" onClick={onClose}>
            {en ? "Close" : "Закрыть"}
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          <ChatBubble side="bot">
            {en
              ? "Hi! Live chat isn’t available yet — we’re building it."
              : "Привет! Живой чат пока не работает — мы его ещё собираем."}
          </ChatBubble>
          <ChatBubble side="bot">
            {en
              ? "For now, open a GitHub issue. We check the tracker regularly."
              : "Пока можно написать через GitHub Issues — мы смотрим трекер регулярно."}
          </ChatBubble>
          <div className="rounded-xl border border-dashed border-line/80 bg-panel-2/50 px-3 py-3 text-center text-xs text-muted">
            {en ? "Chat temporarily unavailable" : "Чат временно недоступен"}
          </div>
          <div className="rounded-2xl border border-line bg-panel-2/40 px-3 py-2 opacity-60">
            <p className="text-[11px] text-muted">{en ? "Message…" : "Сообщение…"}</p>
          </div>
        </div>

        <div className="border-t border-line p-3">
          <a
            href={OWYX_SUPPORT_ISSUE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary w-full justify-center"
          >
            {en ? "Contact via GitHub Issues" : "Связаться через GitHub Issues"}
          </a>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ChatBubble({ side, children }: { side: "bot" | "user"; children: string }) {
  const bot = side === "bot";
  return (
    <div className={`flex ${bot ? "justify-start" : "justify-end"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
          bot
            ? "rounded-bl-md border border-line bg-panel-2 text-text"
            : "rounded-br-md bg-accent text-bg"
        }`}
      >
        {children}
      </div>
    </div>
  );
}
