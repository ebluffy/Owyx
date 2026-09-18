"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import Logo from "@/components/ui/Logo";
import LanguageToggle from "@/components/layout/LanguageToggle";
import ThemeToggle from "@/components/layout/ThemeToggle";
import { useAuth } from "@/hooks/useAuth";
import { useLocale } from "@/hooks/useLocale";
import { resolveSiteAvatarUrl } from "@/lib/avatar";

/**
 * Content column = same max-w-6xl as the footer (green bounds).
 * Download + profile sit on the column’s right edge.
 * Lang + theme stay outside the column, on the viewport right.
 */
export default function Header() {
  const { user, logout } = useAuth();
  const { dict } = useLocale();
  const [open, setOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const NAV = [
    { href: "/", label: dict.header.home },
    { href: "/download", label: dict.header.download },
  ];

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMobileOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  const isStaff = user?.role === "admin" || user?.role === "moderator";

  return (
    <header className="sticky top-0 z-50 border-b border-line/60 bg-bg/55 backdrop-blur-xl liquid-glass-header">
      <div className="relative flex h-16 w-full items-center">
        {/* Outside the content column — viewport right (like beyond the footer). */}
        <div className="pointer-events-none absolute inset-y-0 right-0 z-20 flex items-center pr-3 sm:pr-4">
          <div className="pointer-events-auto flex items-center gap-2">
            <LanguageToggle />
            <ThemeToggle />
            <button
              type="button"
              className="sm:hidden inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-[10px] border border-line bg-panel text-text transition-colors hover:border-accent"
              aria-label={mobileOpen ? dict.header.closeMenu : dict.header.openMenu}
              aria-expanded={mobileOpen}
              aria-controls="mobile-nav"
              onClick={() => setMobileOpen((v) => !v)}
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                {mobileOpen ? (
                  <path strokeLinecap="round" strokeWidth={2} d="M6 6l12 12M18 6L6 18" />
                ) : (
                  <path strokeLinecap="round" strokeWidth={2} d="M4 7h16M4 12h16M4 17h16" />
                )}
              </svg>
            </button>
          </div>
        </div>

        {/* Same width/padding as footer — Download + ЛК on the right green edge. */}
        <div className="mx-auto flex h-full w-full max-w-6xl items-center justify-between gap-3 px-4 sm:px-6 sm:pr-28">
          <div className="flex min-w-0 items-center gap-7">
            <Link href="/" className="flex shrink-0 items-center" aria-label={dict.header.logoHome}>
              <Logo size={26} wordClassName="text-xl" />
            </Link>
            <nav className="hidden sm:flex items-center gap-5" aria-label="Main">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="text-sm text-muted hover:text-accent transition-colors"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            {user ? (
              <>
                <Link href="/download" className="hidden sm:inline-flex btn btn-ghost btn-sm">
                  {dict.header.download}
                </Link>
                <div className="relative" ref={dropdownRef}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpen((v) => !v);
                    }}
                    aria-expanded={open}
                    aria-haspopup="menu"
                    className="flex min-h-11 cursor-pointer items-center gap-2 rounded-[10px] border border-line bg-panel px-3 py-1.5 text-sm transition-colors hover:border-accent"
                  >
                    <span className="grid h-7 w-7 place-items-center overflow-hidden rounded-full bg-panel-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={resolveSiteAvatarUrl(user.avatar_url)}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    </span>
                    <span className="hidden max-w-[10rem] truncate sm:inline">
                      {user.display_nickname || user.nickname || user.email || "Player"}
                    </span>
                  </button>
                  {open && (
                    <div
                      role="menu"
                      className="absolute right-0 mt-2 w-52 overflow-hidden rounded-[14px] border border-line bg-panel shadow-[0_16px_40px_-20px_rgba(0,0,0,0.75)] fade-up"
                    >
                      <Link
                        href="/profile"
                        className="block px-4 py-3 text-sm transition-colors hover:bg-panel-2"
                        role="menuitem"
                      >
                        {dict.header.cabinet}
                      </Link>
                      {isStaff && (
                        <Link
                          href="/admin"
                          className="block border-t border-line px-4 py-3 text-sm transition-colors hover:bg-panel-2"
                          role="menuitem"
                        >
                          {dict.header.admin}
                        </Link>
                      )}
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setOpen(false);
                          logout();
                        }}
                        className="w-full cursor-pointer border-t border-line px-4 py-3 text-left text-sm text-danger transition-colors hover:bg-panel-2"
                      >
                        {dict.header.logout}
                      </button>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <Link
                  href="/login"
                  className="hidden text-sm text-muted transition-colors hover:text-accent sm:inline"
                >
                  {dict.header.login}
                </Link>
                <Link
                  href="/register"
                  className="hidden text-sm text-muted transition-colors hover:text-accent sm:inline"
                >
                  {dict.header.register}
                </Link>
                <Link href="/download" className="btn btn-primary btn-sm">
                  {dict.header.download}
                </Link>
              </>
            )}
          </div>
        </div>
      </div>

      {mobileOpen && (
        <nav
          id="mobile-nav"
          className="flex flex-col gap-1 border-t border-line bg-bg/95 px-4 py-3 backdrop-blur-md fade-up sm:hidden"
          aria-label="Mobile"
        >
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className="rounded-[10px] px-3 py-3 text-sm text-muted transition-colors hover:bg-panel-2 hover:text-accent"
            >
              {item.label}
            </Link>
          ))}
          {!user && (
            <>
              <Link
                href="/login"
                onClick={() => setMobileOpen(false)}
                className="rounded-[10px] px-3 py-3 text-sm text-muted transition-colors hover:bg-panel-2 hover:text-accent"
              >
                {dict.header.login}
              </Link>
              <Link
                href="/register"
                onClick={() => setMobileOpen(false)}
                className="rounded-[10px] px-3 py-3 text-sm text-muted transition-colors hover:bg-panel-2 hover:text-accent"
              >
                {dict.header.register}
              </Link>
            </>
          )}
        </nav>
      )}
    </header>
  );
}
