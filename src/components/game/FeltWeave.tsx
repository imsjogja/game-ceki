import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";

/**
 * Latar kain tenun generatif: kolom garis vertikal dengan tekstur
 * jahitan horizontal yang bergeser perlahan — seperti permukaan
 * meja kasino yang hidup. Warna: hijau felt, emas, merah, krem.
 */
export function FeltWeave({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  pausedRef.current = paused;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const palette = ["#286e44", "#1d5433", "#2f7d4e", "#143c24", "#8e0c26", "#b5850f", "#286e44"];
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let raf = 0;
    let offset = 0;
    let stripes: { x: number; w: number; color: string; dark: string }[] = [];

    function buildStripes(w: number) {
      stripes = [];
      let x = -80;
      let i = 0;
      while (x < w + 160) {
        const sw = 50 + ((i * 53) % 100);
        const color = palette[i % palette.length];
        stripes.push({ x, w: sw, color, dark: shade(color) });
        x += sw;
        i++;
      }
    }

    function shade(hex: string) {
      const n = parseInt(hex.slice(1), 16);
      const r = Math.max(0, ((n >> 16) & 255) - 22);
      const g = Math.max(0, ((n >> 8) & 255) - 22);
      const b = Math.max(0, (n & 255) - 22);
      return `rgb(${r},${g},${b})`;
    }

    function draw() {
      const w = canvas!.width;
      const h = canvas!.height;
      ctx!.clearRect(0, 0, w, h);
      for (const s of stripes) {
        const x = s.x + (offset % 160);
        ctx!.fillStyle = s.color;
        ctx!.fillRect(x, 0, s.w, h);
        // tekstur benang horizontal
        ctx!.fillStyle = s.dark;
        for (let y = 0; y < h; y += 3) {
          ctx!.fillRect(x, y, s.w, 1.2);
        }
        // garis pinggir kolom
        ctx!.fillStyle = "rgba(0,0,0,0.25)";
        ctx!.fillRect(x, 0, 1, h);
      }
    }

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas!.getBoundingClientRect();
      canvas!.width = Math.floor(rect.width * dpr);
      canvas!.height = Math.floor(rect.height * dpr);
      buildStripes(canvas!.width + 320);
      draw();
    }

    function loop() {
      if (!pausedRef.current) {
        offset += 0.18;
        draw();
      }
      raf = requestAnimationFrame(loop);
    }

    resize();
    window.addEventListener("resize", resize);
    if (!reduced) {
      raf = requestAnimationFrame(loop);
    }

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <div className={className} style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
      <button
        onClick={() => setPaused((p) => !p)}
        className="absolute bottom-4 right-4 z-10 flex items-center gap-1.5 rounded-full border border-dashed border-[#FEFEEE]/60 bg-black/30 px-3 py-1.5 text-xs text-[#FEFEEE] backdrop-blur-sm transition-colors hover:bg-black/50"
      >
        {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
        {paused ? "Putar latar" : "Jeda latar"}
      </button>
    </div>
  );
}
