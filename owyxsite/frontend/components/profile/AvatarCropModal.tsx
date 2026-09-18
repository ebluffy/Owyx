"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Modal from "@/components/ui/Modal";

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
  onConfirm: (crop: AvatarCropData) => void;
};

/** Preview frame size (px). Crop circle is 256×256 centered inside. */
const VIEW = 288;
const CROP = 256;
const PAD = (VIEW - CROP) / 2;

/**
 * Start with the full image visible (contain). User zooms in and pans so the
 * circle picks the region. Backend scale = fit × zoom (image-pixel multiplier).
 */
export default function AvatarCropModal({ file, onCancel, onConfirm }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [nat, setNat] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [flipX, setFlipX] = useState(1);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);

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

  const fit =
    nat.w > 0 && nat.h > 0 ? Math.min(VIEW / nat.w, VIEW / nat.h) : 1;
  const displayScale = fit * zoom;

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      drag.current = { x: e.clientX, y: e.clientY, ox: offsetX, oy: offsetY };
    },
    [offsetX, offsetY],
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!drag.current) return;
    setOffsetX(drag.current.ox + (e.clientX - drag.current.x));
    setOffsetY(drag.current.oy + (e.clientY - drag.current.y));
  }, []);

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

  function reset() {
    setZoom(1);
    setRotation(0);
    setFlipX(1);
    setOffsetX(0);
    setOffsetY(0);
  }

  return (
    <Modal
      onClose={onCancel}
      title="Обрезка аватара"
      description="Фото целиком в кадре. Приблизьте и сдвиньте — в круге то, что сохранится (256×256)."
      size="md"
      scrollable={false}
    >
      <div className="space-y-3">
        <div
          ref={frameRef}
          className="relative mx-auto overflow-hidden rounded-2xl border border-line bg-[#0a0a0f] touch-none select-none"
          style={{ width: VIEW, height: VIEW }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
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
                const img = e.currentTarget;
                setNat({ w: img.naturalWidth, h: img.naturalHeight });
              }}
            />
          )}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background: `radial-gradient(circle ${CROP / 2}px at 50% 50%, transparent ${CROP / 2 - 1}px, rgba(0,0,0,0.65) ${CROP / 2}px)`,
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
            Перетащите · колесо = приблизить
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <CropSlider
            label={`Приближение ${zoom.toFixed(2)}×`}
            min={1}
            max={6}
            step={0.01}
            value={zoom}
            onChange={setZoom}
          />
          <CropSlider
            label={`Поворот ${rotation}°`}
            min={-180}
            max={180}
            step={1}
            value={rotation}
            onChange={setRotation}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setFlipX((f) => (f === 1 ? -1 : 1))}
          >
            Отразить
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={reset}>
            Сбросить
          </button>
          <div className="ml-auto flex flex-wrap gap-2">
            <button type="button" className="btn btn-ghost" onClick={onCancel}>
              Отмена
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!nat.w}
              onClick={() =>
                onConfirm({
                  scale: displayScale,
                  rotation,
                  flipX,
                  offsetX,
                  offsetY,
                  cropSize: CROP,
                })
              }
            >
              Сохранить
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
