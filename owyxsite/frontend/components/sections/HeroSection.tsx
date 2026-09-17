"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { useLocale } from "@/hooks/useLocale";

/**
 * Brand-first first viewport (DESIGN.md §5):
 * 1. Owyx™ wordmark · Unbounded / Sora techno-grotesque.
 * 2. One value line · private Minecraft ecosystem.
 * 3. Compact live server status + click-to-copy IP pill.
 * 4. Primary tactile CTA + secondary auth.
 * 5. Authentic desktop launcher showcase preview.
 */
export default function HeroSection() {
  const { user, loading } = useAuth();
  const { dict } = useLocale();
  const [copied, setCopied] = useState(false);

  const SERVER_IP = "mc.owyx.site";

  const handleCopyIp = useCallback(async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(SERVER_IP);
      } else {
        const ta = document.createElement("textarea");
        ta.value = SERVER_IP;
        ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      /* ignore */
    }
  }, [SERVER_IP]);

  return (
    <section className="relative overflow-hidden min-h-[min(82vh,46rem)] flex items-center py-12 sm:py-16">
      <div className="hero-aurora" aria-hidden="true" />
      <div className="hero-grid" aria-hidden="true" />

      <div className="relative z-[1] w-full max-w-6xl mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-8 items-center">
          {/* Left / Primary column */}
          <div className="lg:col-span-7 min-w-0">
            {/* Version & Status badge */}
            <div className="fade-up inline-flex items-center gap-2 rounded-full border border-line bg-panel-2/80 px-3 py-1 text-xs font-mono text-muted mb-6 backdrop-blur-md">
              <span className="h-1.5 w-1.5 rounded-full bg-accent pulse-dot" aria-hidden="true" />
              <span className="text-text/90 font-medium">{dict.home.betaEyebrow}</span>
              <span className="text-line">/</span>
              <span className="text-accent/90">v0.5.2</span>
            </div>

            {/* Main Brand Title */}
            <h1 className="fade-up font-display text-[clamp(2.8rem,9vw,5.25rem)] font-bold tracking-[-0.04em] leading-[0.95] break-words min-w-0 text-text">
              <span className="text-accent hero-title-glow">
                {dict.home.heroTitle}
                <sup className="ml-1 text-[0.38em] font-semibold tracking-normal text-accent/80 align-super">
                  ™
                </sup>
              </span>
            </h1>

            {/* Value sentence */}
            <p className="fade-up-2 mt-5 text-base sm:text-lg text-muted max-w-xl leading-relaxed">
              {dict.home.heroLead}
            </p>

            {/* Compact Server status & Quick connect pill (DESIGN.md §5 item 3) */}
            <div className="fade-up-2 mt-6 inline-flex flex-wrap items-center gap-2.5 rounded-xl border border-line bg-panel/75 p-1.5 sm:pr-3 backdrop-blur-md">
              <div className="flex items-center gap-2 px-2.5 py-1">
                <span className="h-2 w-2 rounded-full bg-ok pulse-dot" aria-hidden="true" />
                <span className="text-xs font-medium text-ok">
                  {dict.servers?.statusOnline ?? "Онлайн"}
                </span>
              </div>
              <div className="hidden sm:block h-3.5 w-px bg-line" aria-hidden="true" />
              <button
                type="button"
                onClick={handleCopyIp}
                title={dict.servers?.copyIp ?? "Скопировать IP"}
                className="inline-flex items-center gap-2 rounded-lg border border-line/60 bg-panel-2/80 px-3 py-1.5 font-mono text-xs text-text hover:border-accent hover:text-accent transition-colors cursor-pointer"
              >
                <span>{SERVER_IP}</span>
                {copied ? (
                  <svg className="h-3.5 w-3.5 text-ok" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg className="h-3.5 w-3.5 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                )}
                <span className="text-[11px] text-muted">
                  {copied ? (dict.servers?.copiedIp ?? "Скопировано!") : (dict.servers?.copyIp ?? "Копировать")}
                </span>
              </button>
            </div>

            {/* Tactile Action Buttons */}
            <div className="fade-up-3 mt-8 flex flex-wrap items-center gap-3.5">
              <Link href="/download" className="btn btn-primary btn-lg group">
                <svg
                  className="w-5 h-5 transition-transform group-hover:translate-y-0.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2.2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                  />
                </svg>
                <span>{dict.home.downloadLauncher}</span>
              </Link>
              {loading ? (
                <span className="btn btn-secondary btn-lg pointer-events-none opacity-60">
                  {dict.home.loading}
                </span>
              ) : user ? (
                <Link href="/profile" className="btn btn-secondary btn-lg">
                  <span>{dict.home.toCabinet}</span>
                </Link>
              ) : (
                <Link href="/login" className="btn btn-secondary btn-lg">
                  <span>{dict.home.signInCreate}</span>
                </Link>
              )}
            </div>
          </div>

          {/* Right column: Authentic Desktop Launcher Preview Widget */}
          <div className="lg:col-span-5 hidden lg:block">
            <div className="fade-up-2 relative rounded-2xl border border-line/90 bg-gradient-to-b from-[#161622]/90 to-[#0d0d14]/95 p-5 shadow-[0_24px_50px_-20px_rgba(0,0,0,0.85)] backdrop-blur-xl">
              {/* Subtle top edge specular line */}
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/40 to-transparent" />

              {/* Launcher Mock Window Header */}
              <div className="flex items-center justify-between pb-4 border-b border-line/70">
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full bg-[#ff5f56]/80" />
                  <span className="h-3 w-3 rounded-full bg-[#ffbd2e]/80" />
                  <span className="h-3 w-3 rounded-full bg-[#27c93f]/80" />
                </div>
                <div className="flex items-center gap-2 font-mono text-xs text-muted">
                  <span className="text-accent font-semibold">Owyx</span>
                  <span>v0.5.2</span>
                </div>
                <span className="rounded-full bg-accent/10 border border-accent/30 px-2 py-0.5 text-[10px] font-mono text-accent">
                  Desktop
                </span>
              </div>

              {/* Launcher Body Content */}
              <div className="pt-4 space-y-3.5">
                {/* Server Quick Card */}
                <div className="rounded-xl border border-line bg-panel-2/60 p-3.5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent/10 border border-accent/30 text-accent font-bold font-mono text-sm">
                      Ω
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-text truncate">
                        {dict.servers?.mainServer ?? "Основной сервер"}
                      </div>
                      <div className="text-xs text-muted font-mono">1.20.4 · Vanilla / Mods</div>
                    </div>
                  </div>
                  <span className="shrink-0 flex items-center gap-1.5 text-xs text-ok font-mono">
                    <span className="h-1.5 w-1.5 rounded-full bg-ok pulse-dot" />
                    24ms
                  </span>
                </div>

                {/* Features badges */}
                <div className="grid grid-cols-2 gap-2 text-xs font-medium">
                  <div className="rounded-lg border border-line/60 bg-panel/50 p-2.5 flex items-center gap-2 text-text/90">
                    <span className="text-accent">✓</span>
                    <span className="truncate">Offline никнейм</span>
                  </div>
                  <div className="rounded-lg border border-line/60 bg-panel/50 p-2.5 flex items-center gap-2 text-text/90">
                    <span className="text-accent">✓</span>
                    <span className="truncate">Microsoft OAuth</span>
                  </div>
                </div>

                {/* Launcher Play Bar */}
                <div className="pt-2">
                  <Link
                    href="/download"
                    className="w-full flex items-center justify-between rounded-xl border border-accent/40 bg-gradient-to-r from-accent/20 via-accent/10 to-transparent p-3 hover:border-accent hover:from-accent/30 transition-all group"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-[#021720] font-bold shadow-[0_0_12px_rgba(0,229,255,0.4)] group-hover:scale-105 transition-transform">
                        ▶
                      </span>
                      <div>
                        <div className="text-xs font-semibold text-text">Готов к запуску</div>
                        <div className="text-[11px] text-muted">Нажми, чтобы скачать клиент</div>
                      </div>
                    </div>
                    <span className="text-xs font-mono text-accent group-hover:translate-x-0.5 transition-transform">
                      Play →
                    </span>
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
