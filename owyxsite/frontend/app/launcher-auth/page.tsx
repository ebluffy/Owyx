"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import AuthShell from "@/components/layout/AuthShell";
import { useAuth } from "@/hooks/useAuth";
import { useLocale } from "@/hooks/useLocale";

function isLoopbackPort(port: string): boolean {
  const n = Number(port);
  return Number.isInteger(n) && n >= 1 && n <= 65535;
}

function isSafeState(state: string): boolean {
  return /^[A-Za-z0-9_-]{16,128}$/.test(state);
}

function LauncherAuthInner() {
  const { dict } = useLocale();
  const a = dict.auth;
  const c = dict.common;
  const router = useRouter();
  const params = useSearchParams();
  const { user, loading } = useAuth();

  const port = (params.get("port") || "").trim();
  const state = (params.get("state") || "").trim();
  const valid = isLoopbackPort(port) && isSafeState(state);

  const loginHref = useMemo(() => {
    const q = new URLSearchParams({
      redirect: `/launcher-auth?port=${encodeURIComponent(port)}&state=${encodeURIComponent(state)}`,
    });
    return `/login?${q.toString()}`;
  }, [port, state]);

  const [status, setStatus] = useState<"idle" | "working" | "done" | "error">("idle");
  const [error, setError] = useState("");

  const complete = useCallback(async () => {
    if (!valid || !user) return;
    setStatus("working");
    setError("");
    try {
      const token = localStorage.getItem("auth_token");
      if (!token) {
        router.replace(loginHref);
        return;
      }
      const res = await fetch("/api/auth/launcher/prepare", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ state }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.code) {
        setStatus("error");
        setError(String(data.error || a.loginFailed));
        return;
      }
      const redirect = `http://127.0.0.1:${port}/?code=${encodeURIComponent(data.code)}&state=${encodeURIComponent(state)}`;
      setStatus("done");
      window.location.href = redirect;
    } catch {
      setStatus("error");
      setError(c.networkError);
    }
  }, [a.loginFailed, c.networkError, loginHref, port, router, state, user, valid]);

  useEffect(() => {
    if (loading || !valid) return;
    if (!user) return;
    if (status !== "idle") return;
    void complete();
  }, [complete, loading, status, user, valid]);

  if (!valid) {
    return (
      <AuthShell title={a.launcherAuthTitle} subtitle={a.launcherAuthBadLink}>
        <div className="panel p-5 text-sm text-muted">
          <Link href="/login" className="link-accent">
            {a.submitLogin}
          </Link>
        </div>
      </AuthShell>
    );
  }

  if (loading) {
    return (
      <AuthShell title={a.launcherAuthTitle} subtitle={c.checking}>
        <div className="panel p-5 text-sm text-muted">{c.checking}</div>
      </AuthShell>
    );
  }

  if (!user) {
    return (
      <AuthShell title={a.launcherAuthTitle} subtitle={a.launcherAuthNeedLogin}>
        <div className="space-y-4">
          <p className="text-sm text-muted m-0">{a.launcherAuthNeedLoginBody}</p>
          <Link href={loginHref} className="btn btn-primary w-full inline-flex justify-center">
            {a.submitLogin}
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={a.launcherAuthTitle}
      subtitle={status === "done" ? a.launcherAuthDone : a.launcherAuthWorking}
    >
      <div className="panel p-5 text-sm text-muted space-y-3">
        {status === "error" && <p className="text-danger m-0">{error}</p>}
        {(status === "idle" || status === "working") && <p className="m-0">{a.launcherAuthWorking}</p>}
        {status === "done" && <p className="m-0 text-ok">{a.launcherAuthDone}</p>}
        {status === "error" && (
          <button type="button" className="btn btn-primary w-full" onClick={() => { setStatus("idle"); }}>
            {a.launcherAuthRetry}
          </button>
        )}
      </div>
    </AuthShell>
  );
}

export default function LauncherAuthPage() {
  return (
    <Suspense fallback={<div className="panel p-5 text-sm text-muted">…</div>}>
      <LauncherAuthInner />
    </Suspense>
  );
}
