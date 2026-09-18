"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import AuthShell from "@/components/layout/AuthShell";
import Turnstile from "@/components/ui/Turnstile";
import { useLocale } from "@/hooks/useLocale";

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "";

export default function ForgotPasswordPage() {
  const { dict } = useLocale();
  const a = dict.auth;
  const c = dict.common;

  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileReset, setTurnstileReset] = useState(0);

  const onToken = useCallback((t: string | null) => setTurnstileToken(t), []);

  function refreshTurnstile() {
    setTurnstileToken(null);
    setTurnstileReset((n) => n + 1);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (SITE_KEY && !turnstileToken) {
      setError(a.captchaRequired);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, turnstileToken: turnstileToken || undefined }),
      });
      if (res.ok) {
        setSent(true);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || a.forgotFailed);
        refreshTurnstile();
      }
    } catch {
      setError(c.networkError);
      refreshTurnstile();
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title={a.forgotTitle}
      subtitle={a.forgotSubtitle}
      footer={
        <Link href="/login" className="link-accent">
          {a.backToLogin}
        </Link>
      }
    >
      {sent ? (
        <div className="panel p-5 text-sm text-muted">{a.forgotSent}</div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="field-label" htmlFor="email">
              {a.email}
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              className="input"
              placeholder={a.emailPlaceholder}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          {SITE_KEY && (
            <Turnstile siteKey={SITE_KEY} onToken={onToken} resetKey={turnstileReset} />
          )}
          {error && <p className="text-sm text-danger">{error}</p>}
          <button type="submit" className="btn btn-primary w-full" disabled={loading}>
            {loading ? a.forgotSending : a.forgotSubmit}
          </button>
        </form>
      )}
    </AuthShell>
  );
}
