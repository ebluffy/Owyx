"use client";

import { useEffect, useRef } from "react";

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  baseAlpha: number;
  twinkleSpeed: number;
  phase: number;
  depth: 1 | 2 | 3; // 1 = distant star, 2 = mid dust, 3 = foreground glowing crystal
};

/**
 * Cinematic deep-space particle atmosphere for Owyx.
 * Ambient starfield with multi-depth cosmic dust and gentle organic twinkling.
 * Zero tacky spiderweb connecting lines. O(N) performance, silky 60fps.
 * Respects prefers-reduced-motion + Page Visibility.
 */
export default function SpaceParticles() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      canvas.style.display = "none";
      return;
    }

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    let raf = 0;
    let running = true;
    let w = 0;
    let h = 0;
    let dpr = 1;
    let particles: Particle[] = [];

    function countForViewport() {
      const area = w * h;
      if (area < 500_000) return 40;
      if (area < 1_200_000) return 70;
      return 100;
    }

    function spawn(n: number) {
      particles = Array.from({ length: n }, () => {
        const roll = Math.random();
        // 60% distant micro-stars, 30% mid dust, 10% foreground crystal motes
        const depth: 1 | 2 | 3 = roll < 0.6 ? 1 : roll < 0.9 ? 2 : 3;

        let r = 0.6;
        let baseAlpha = 0.25;
        let speed = 0.1;

        if (depth === 1) {
          r = Math.random() * 0.7 + 0.4;
          baseAlpha = Math.random() * 0.25 + 0.15;
          speed = 0.08;
        } else if (depth === 2) {
          r = Math.random() * 0.9 + 0.9;
          baseAlpha = Math.random() * 0.35 + 0.3;
          speed = 0.16;
        } else {
          r = Math.random() * 1.2 + 1.5;
          baseAlpha = Math.random() * 0.35 + 0.5;
          speed = 0.24;
        }

        return {
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * speed * 0.6,
          vy: -(Math.random() * speed + 0.03), // gentle upward float
          r,
          baseAlpha,
          twinkleSpeed: Math.random() * 0.025 + 0.008,
          phase: Math.random() * Math.PI * 2,
          depth,
        };
      });
    }

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas!.width = Math.floor(w * dpr);
      canvas!.height = Math.floor(h * dpr);
      canvas!.style.width = `${w}px`;
      canvas!.style.height = `${h}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      spawn(countForViewport());
    }

    function tick() {
      if (!running || !ctx) return;
      ctx.clearRect(0, 0, w, h);

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.phase += p.twinkleSpeed;

        // Wrap around screen edges
        if (p.x < -10) p.x = w + 10;
        if (p.x > w + 10) p.x = -10;
        if (p.y < -10) p.y = h + 10;
        if (p.y > h + 10) p.y = -10;

        // Organic cosine twinkle
        const alpha = Math.max(0.08, p.baseAlpha * (0.65 + 0.35 * Math.sin(p.phase)));

        if (p.depth === 3) {
          // Foreground glowing cyan crystal mote with radial aura
          const glowGrad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 3.5);
          glowGrad.addColorStop(0, `rgba(0, 229, 255, ${alpha * 0.8})`);
          glowGrad.addColorStop(0.4, `rgba(0, 229, 255, ${alpha * 0.3})`);
          glowGrad.addColorStop(1, "rgba(0, 229, 255, 0)");

          ctx.fillStyle = glowGrad;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r * 3.5, 0, Math.PI * 2);
          ctx.fill();

          // Bright center
          ctx.fillStyle = `rgba(220, 250, 255, ${alpha})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r * 0.85, 0, Math.PI * 2);
          ctx.fill();
        } else if (p.depth === 2) {
          // Midground cyan dust
          ctx.fillStyle = `rgba(0, 229, 255, ${alpha})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // Distant star point
          ctx.fillStyle = `rgba(215, 240, 255, ${alpha * 0.85})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      raf = window.requestAnimationFrame(tick);
    }

    function onVisibility() {
      running = document.visibilityState === "visible";
      if (running) raf = window.requestAnimationFrame(tick);
      else window.cancelAnimationFrame(raf);
    }

    resize();
    raf = window.requestAnimationFrame(tick);
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      running = false;
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <canvas ref={canvasRef} className="owyx-particles" aria-hidden="true" />;
}
