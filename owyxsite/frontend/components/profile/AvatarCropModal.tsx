"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Modal from "@/components/ui/Modal";
import { useLocale } from "@/hooks/useLocale";
import {
  AVATAR_CROP_PX,
  AVATAR_VIEW_PX,
  avatarCoverBase,
  clampAvatarOffset,
  renderAvatarCropPng,
} from "@/lib/avatarCropCanvas";

export type AvatarCropData = {
  scale: number;
  rotation: number;
  flipX: number;
  offsetX: number;
  offsetY: number;
  cropSize: number;
};

type Props = {
  file: File;
  onCancel: () => void;
  onConfirm: (cropped: File) => void;
};

const VIEW = AVATAR_VIEW_PX;
const CROP = AVATAR_CROP_PX;
const PAD = (VIEW - CROP) / 2;
const RADIUS = CROP / 2;

/**
 * Pan/zoom are clamped so the uploaded photo always fills the crop circle
 * (no empty black inside the circle). Outside the circle stays dimmed.
 */
export default function AvatarCropModal({ file, onCancel, onConfirm }: Props) {
  const { dict } = useLocale();
  const t = dict.profile;
  const c = dict.common;

  const [url, setUrl] = useState<string | null>(null);
  const [nat, setNat] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [flipX, setFlipX] = useState(1);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [saving, setSaving] = useState(false);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const offsetRef = useRef({ x: 0, y: 0 });
  offsetRef.current = { x: offsetX, y: offsetY };

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    setZoom(1);
    setRotation(0);
    setFlipX(1);
    setOffsetX(0);
    setOffsetY(0);
    setNat({ w: 0, h: 0 });
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  const displayScale = useMemo(
    () => avatarCoverBase(nat.w, nat.h) * zoom,
    [nat.w, nat.h, zoom],
  );

  const applyClamp = useCallback(
    (ox: number, oy: number, nextZoom = zoom, nextRot = rotation) =>
      clampAvatarOffset(ox, oy, nat.w, nat.h, nextZoom, nextRot),
    [nat.w, nat.h, zoom, rotation],
  );

  useEffect(() => {
    if (!nat.w) return;
    const { x, y } = offsetRef.current;
    const clamped = applyClamp(x, y);
    if (clamped.x !== x) setOffsetX(clamped.x);
    if (clamped.y !== y) setOffsetY(clamped.y);
  }, [nat.w, nat.h, zoom, rotation, applyClamp]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      drag.current = { x: e.clientX, y: e.clientY, ox: offsetX, oy: offsetY };
    },
    [offsetX, offsetY],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!drag.current) return;
      const next = applyClamp(
        drag.current.ox + (e.clientX - drag.current.x),
        drag.current.oy + (e.clientY - drag.current.y),
      );
      setOffsetX(next.x);
      setOffsetY(next.y);
    },
    [applyClamp],
  );

  const onPointerUp = useCallback(() => {
    drag.current = null;
  }, []);

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.08 : 0.08;
      setZoom((z) => Math.min(6, Math.max(1, Number((z + delta).toFixed(2)))));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [url]);

  function setZoomClamped(next: number) {
    const z = Math.min(6, Math.max(1, next));
    setZoom(z);
    const clamped = applyClamp(offsetX, offsetY, z, rotation);
    setOffsetX(clamped.x);
    setOffsetY(clamped.y);
  }

  function setRotationClamped(next: number) {
    setRotation(next);
    const clamped = applyClamp(offsetX, offsetY, zoom, next);
    setOffsetX(clamped.x);
    setOffsetY(clamped.y);
  }

  function reset() {
    setZoom(1);
    setRotation(0);
    setFlipX(1);
    setOffsetX(0);
    setOffsetY(0);
  }

  async function handleSave() {
    const img = imgRef.current;
    if (!img || !nat.w) return;
    setSaving(true);
    try {
      const clamped = applyClamp(offsetX, offsetY);
      const blob = await renderAvatarCropPng(img, {
        naturalWidth: nat.w,
        naturalHeight: nat.h,
        zoom,
        rotation,
        flipX,
        offsetX: clamped.x,
        offsetY: clamped.y,
      });
      const cropped = new File([blob], "avatar-cropped.png", { type: "image/png" });
      onConfirm(cropped);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      onClose={onCancel}
      title={t.cropTitle}
      description={t.cropHint}
      size="md"
      scrollable
      panelClassName="max-h-[min(92vh,44rem)]"
    >
      <div className="space-y-3">
        <div
          ref={frameRef}
          className="relative mx-auto overflow-hidden rounded-2xl border border-line bg-surface touch-none select-none"
          style={{ width: VIEW, height: VIEW }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              ref={imgRef}
              src={url}
              alt=""
              draggable={false}
              className="absolute left-1/2 top-1/2 max-w-none pointer-events-none"
              style={{
                width: nat.w || undefined,
                height: nat.h || undefined,
                transform: `translate(calc(-50% + ${offsetX}px), calc(-50% + ${offsetY}px)) rotate(${rotation}deg) scale(${flipX * displayScale}, ${displayScale})`,
              }}
              onLoad={(e) => {
                const image = e.currentTarget;
                setNat({ w: image.naturalWidth, h: image.naturalHeight });
              }}
            />
          )}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background: `radial-gradient(circle ${RADIUS}px at 50% 50%, transparent ${RADIUS - 1}px, rgba(0,0,0,0.55) ${RADIUS}px)`,
            }}
          />
          <div
            className="pointer-events-none absolute rounded-full border border-accent/55"
            style={{
              width: CROP,
              height: CROP,
              left: PAD,
              top: PAD,
              boxShadow: "0 0 0 1px rgba(0,0,0,0.35)",
            }}
          />
          <p className="pointer-events-none absolute bottom-2 left-0 right-0 text-center text-[10px] text-white/55">
            {t.cropGestureHint}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <CropSlider
            label={`${t.cropZoom} ${zoom.toFixed(2)}×`}
            min={1}
            max={6}
            step={0.01}
            value={zoom}
            onChange={setZoomClamped}
          />
          <CropSlider
            label={`${t.cropRotate} ${rotation}°`}
            min={-180}
            max={180}
            step={1}
            value={rotation}
            onChange={setRotationClamped}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 pb-1">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setFlipX((f) => (f === 1 ? -1 : 1))}
          >
            {t.cropFlip}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={reset}>
            {t.cropReset}
          </button>
          <div className="ml-auto flex flex-wrap gap-2">
            <button type="button" className="btn btn-ghost" onClick={onCancel}>
              {c.cancel}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!nat.w || saving}
              onClick={() => void handleSave()}
            >
              {saving ? c.saving : c.save}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function CropSlider({
  label,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block text-xs text-muted">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="crop-range w-full"
      />
    </label>
  );
}
