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

const VIEW = 280;
const CROP = 256;

/** Zoom / pan / rotate cropper; output matches backend cropData. */
export default function AvatarCropModal({ file, onCancel, onConfirm }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [flipX, setFlipX] = useState(1);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    setScale(1);
    setRotation(0);
    setFlipX(1);
    setOffsetX(0);
    setOffsetY(0);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

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
      const delta = e.deltaY > 0 ? -0.06 : 0.06;
      setScale((s) => Math.min(4, Math.max(0.4, Number((s + delta).toFixed(2)))));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [url]);

  function reset() {
    setScale(1);
    setRotation(0);
    setFlipX(1);
    setOffsetX(0);
    setOffsetY(0);
  }

  return (
    <Modal
      onClose={onCancel}
      title="Обрезка аватара"
      description="Перетащите фото, крутите колесом для масштаба. На сервер уйдёт квадрат 256×256."
      size="md"
    >
      <div className="space-y-4">
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
                transform: `translate(calc(-50% + ${offsetX}px), calc(-50% + ${offsetY}px)) rotate(${rotation}deg) scale(${flipX * scale}, ${scale})`,
              }}
            />
          )}
          {/* Dim outside circle crop guide */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(circle closest-side, transparent 69%, rgba(0,0,0,0.62) 70%)",
            }}
          />
          <div className="pointer-events-none absolute inset-[14%] rounded-full border border-accent/50 shadow-[0_0_0_1px_rgba(0,0,0,0.35)]" />
          <p className="pointer-events-none absolute bottom-2 left-0 right-0 text-center text-[10px] text-white/55">
            Перетащите · колесо = масштаб
          </p>
        </div>

        <div className="space-y-3">
          <CropSlider
            label={`Масштаб ${scale.toFixed(2)}×`}
            min={0.4}
            max={4}
            step={0.01}
            value={scale}
            onChange={setScale}
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

        <div className="flex flex-wrap gap-2">
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
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() =>
              onConfirm({
                scale,
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
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Отмена
          </button>
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
    <label className="block">
      <span className="mb-1.5 flex items-center justify-between text-xs text-muted">
        <span>{label}</span>
      </span>
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
