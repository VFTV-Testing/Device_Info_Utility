import { useEffect, useRef } from "react";
import type { Theme } from "../../hooks";

/**
 * Canvas-drawn page backgrounds (currently "Data rain", the default), on a fixed full-screen canvas behind everything.
 * Decorative only: no pointer events, pauses in hidden tabs (requestAnimationFrame),
 * and draws a single still frame when the user prefers reduced motion.
 */
export type CanvasScene = "rain";

interface Palette {
  accent: string;
  cyan: string;
  dark: boolean;
}

interface Scene {
  resize(width: number, height: number): void;
  frame(dt: number): void;
}

/** Mirrors the --hw-* tokens in index.css (read directly so a theme switch never shows stale colours). */
const PALETTES: Record<Theme, Palette> = {
  dark: { accent: "#818cf8", cyan: "#22d3ee", dark: true },
  light: { accent: "#4f46e5", cyan: "#0891b2", dark: false },
};

const rand = (min: number, max: number) => min + Math.random() * (max - min);

/** Data rain: slow columns of hex / firmware characters. */
function rainScene(ctx: CanvasRenderingContext2D, p: Palette, size = 15): Scene {
  let w = 0;
  let h = 0;
  const CHARS = "0123456789ABCDEF.+-_";
  let columns: { x: number; y: number; speed: number; chars: string[]; trail: number; color: string }[] = [];
  const pick = () => CHARS[Math.floor(Math.random() * CHARS.length)]!;
  return {
    resize(width, height) {
      w = width;
      h = height;
      const count = Math.floor(w / (size * 1.6));
      columns = Array.from({ length: count }, (_, i) => ({
        x: i * size * 1.6 + rand(0, 4),
        y: rand(0, h * 1.5),
        speed: rand(0.02, 0.06),
        trail: Math.floor(rand(8, 20)),
        chars: Array.from({ length: 24 }, pick),
        color: Math.random() < 0.75 ? p.accent : p.cyan,
      }));
    },
    frame(dt) {
      ctx.clearRect(0, 0, w, h);
      ctx.font = `500 ${size - 2}px "JetBrains Mono Variable", ui-monospace, monospace`;
      ctx.textAlign = "center";
      for (const c of columns) {
        c.y += c.speed * dt;
        if (c.y - c.trail * size > h) {
          c.y = rand(-200, 0);
          c.speed = rand(0.02, 0.06);
        }
        if (Math.random() < 0.02) c.chars[Math.floor(rand(0, c.chars.length))] = pick();
        for (let k = 0; k < c.trail; k++) {
          const y = c.y - k * size;
          if (y < -size || y > h + size) continue;
          ctx.globalAlpha = (k === 0 ? 0.9 : (1 - k / c.trail) * 0.45) * (p.dark ? 0.75 : 0.5);
          ctx.fillStyle = k === 0 ? p.cyan : c.color;
          ctx.fillText(c.chars[k % c.chars.length]!, c.x, y);
        }
      }
      ctx.globalAlpha = 1;
    },
  };
}

function setup(canvas: HTMLCanvasElement, width: number, height: number, ratio: number, theme: Theme, size?: number): Scene | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  const scene = rainScene(ctx, PALETTES[theme], size);
  scene.resize(width, height);
  return scene;
}

/** A small still frame of a scene, for the Appearance menu. */
export function ScenePreview({ theme, className }: { scene: CanvasScene; theme: Theme; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const scene = setup(canvas, canvas.clientWidth || 96, canvas.clientHeight || 56, Math.min(window.devicePixelRatio || 1, 2), theme, 9);
    scene?.frame(16);
  }, [theme]);
  return <canvas ref={ref} aria-hidden className={className} />;
}

export function AnimatedBackground({ theme }: { scene: CanvasScene; theme: Theme }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let scene = setup(canvas, window.innerWidth, window.innerHeight, ratio, theme);
    if (!scene) return;

    const resize = () => {
      scene = setup(canvas, window.innerWidth, window.innerHeight, ratio, theme) ?? scene;
      if (reduce) scene?.frame(16);
    };

    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      scene?.frame(Math.min(now - last, 50));
      last = now;
      raf = requestAnimationFrame(loop);
    };
    if (reduce) scene.frame(16);
    else raf = requestAnimationFrame(loop);

    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [theme]);

  return <canvas ref={ref} aria-hidden className="pointer-events-none fixed inset-0 -z-10 size-full" />;
}

export function isCanvasScene(id: string): id is CanvasScene {
  return id === "rain";
}
