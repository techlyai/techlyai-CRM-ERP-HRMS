"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Minus, Plus } from "lucide-react";

export type MapMarker = {
  id: string;
  lat: number;
  lng: number;
  label: string;
  kind: "point" | "photo" | "site" | "live" | "visit" | "start" | "end";
  tone?: "green" | "red" | "amber" | "gray" | "blue";
  detail?: React.ReactNode;
};
export type MapCircle = { id: string; lat: number; lng: number; radius: number; label: string };

const TILE = 256;
const tilesEnabled = process.env.NEXT_PUBLIC_ATTENDANCE_MAP === "openstreetmap";
// Web Mercator world pixel coordinates at a zoom level.
const project = (lat: number, lng: number, z: number) => {
  const s = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
  const scale = TILE * 2 ** z;
  return { x: ((lng + 180) / 360) * scale, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale };
};
const unproject = (x: number, y: number, z: number) => {
  const scale = TILE * 2 ** z;
  const lng = (x / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / scale;
  return { lat: (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), lng };
};
const metersPerPixel = (lat: number, z: number) => (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;
const toneColor: Record<string, string> = {
  green: "hsl(var(--success))",
  red: "hsl(var(--danger))",
  amber: "hsl(var(--warning))",
  gray: "hsl(var(--muted-foreground))",
  blue: "hsl(var(--primary))",
};

/**
 * Interactive map: drag to pan, wheel or buttons to zoom, click markers for details.
 * Map tiles are fetched from OpenStreetMap only when NEXT_PUBLIC_ATTENDANCE_MAP=openstreetmap;
 * otherwise positions are drawn on a coordinate grid and nothing leaves Orbit.
 */
export function FieldMap({
  markers,
  route = [],
  circles = [],
  height = 420,
  selected,
  onSelect,
}: {
  markers: MapMarker[];
  route?: [number, number][];
  circles?: MapCircle[];
  height?: number;
  selected?: string | null;
  onSelect?: (id: string | null) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [view, setView] = useState<{ lat: number; lng: number; z: number } | null>(null);
  const drag = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);
  const [active, setActive] = useState<string | null>(selected ?? null);
  useEffect(() => setActive(selected ?? null), [selected]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth || 640));
    ro.observe(el);
    setWidth(el.clientWidth || 640);
    return () => ro.disconnect();
  }, []);

  const all = useMemo(
    () => [
      ...markers.map((m) => [m.lat, m.lng] as [number, number]),
      ...route,
      ...circles.flatMap((c) => {
        const d = c.radius / 111320;
        return [[c.lat + d, c.lng + d] as [number, number], [c.lat - d, c.lng - d] as [number, number]];
      }),
    ],
    [markers, route, circles],
  );
  const fit = useMemo(() => {
    if (!all.length) return { lat: 20.5937, lng: 78.9629, z: 4 };
    const lats = all.map((p) => p[0]);
    const lngs = all.map((p) => p[1]);
    const north = Math.max(...lats), south = Math.min(...lats), east = Math.max(...lngs), west = Math.min(...lngs);
    let z = 18;
    while (z > 2) {
      const a = project(north, west, z), b = project(south, east, z);
      if (b.x - a.x < width - 60 && b.y - a.y < height - 60) break;
      z--;
    }
    const c = unproject((project(north, west, z).x + project(south, east, z).x) / 2, (project(north, west, z).y + project(south, east, z).y) / 2, z);
    return { lat: c.lat, lng: c.lng, z };
  }, [all, width, height]);
  const v = view || fit;
  // Re-fit whenever the data changes.
  useEffect(() => setView(null), [all]);

  const center = project(v.lat, v.lng, v.z);
  const origin = { x: center.x - width / 2, y: center.y - height / 2 };
  const px = (lat: number, lng: number) => {
    const p = project(lat, lng, v.z);
    return { x: p.x - origin.x, y: p.y - origin.y };
  };
  const zoom = (dz: number) => setView({ ...v, z: Math.max(2, Math.min(19, v.z + dz)) });

  const tiles: { key: string; x: number; y: number; src: string }[] = [];
  if (tilesEnabled) {
    const n = 2 ** v.z;
    for (let tx = Math.floor(origin.x / TILE); tx <= Math.floor((origin.x + width) / TILE); tx++)
      for (let ty = Math.floor(origin.y / TILE); ty <= Math.floor((origin.y + height) / TILE); ty++) {
        if (ty < 0 || ty >= n) continue;
        const wx = ((tx % n) + n) % n;
        tiles.push({ key: `${v.z}/${tx}/${ty}`, x: tx * TILE - origin.x, y: ty * TILE - origin.y, src: `https://tile.openstreetmap.org/${v.z}/${wx}/${ty}.png` });
      }
  }
  // Grid lines every "nice" degree step when tiles are off.
  const grid: { x?: number; y?: number; label: string }[] = [];
  if (!tilesEnabled) {
    const tl = unproject(origin.x, origin.y, v.z), br = unproject(origin.x + width, origin.y + height, v.z);
    const span = Math.max(br.lng - tl.lng, 1e-6);
    const step = [10, 5, 1, 0.5, 0.1, 0.05, 0.01, 0.005, 0.001, 0.0005, 0.0001].find((s) => span / s >= 3) || 0.0001;
    for (let g = Math.ceil(tl.lng / step) * step; g <= br.lng; g += step) grid.push({ x: px(tl.lat, g).x, label: g.toFixed(4) });
    for (let g = Math.ceil(br.lat / step) * step; g <= tl.lat; g += step) grid.push({ y: px(g, tl.lng).y, label: g.toFixed(4) });
  }
  const scaleM = metersPerPixel(v.lat, v.z) * 100;
  const scaleLabel = scaleM >= 1000 ? `${(scaleM / 1000).toFixed(scaleM >= 10000 ? 0 : 1)} km` : `${Math.round(scaleM)} m`;
  const current = markers.find((m) => m.id === active);

  return (
    <div
      ref={box}
      className="relative select-none overflow-hidden rounded-xl border border-border bg-muted/40"
      style={{ height, touchAction: "none" }}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest("button,a")) return;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, y: e.clientY, cx: center.x, cy: center.y };
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        const c = unproject(drag.current.cx - (e.clientX - drag.current.x), drag.current.cy - (e.clientY - drag.current.y), v.z);
        setView({ lat: c.lat, lng: c.lng, z: v.z });
      }}
      onPointerUp={() => (drag.current = null)}
      onWheel={(e) => zoom(e.deltaY < 0 ? 1 : -1)}
      role="application"
      aria-label="Map of recorded field locations. Drag to move, use the zoom buttons, select a marker for details."
    >
      {tiles.map((t) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={t.key} src={t.src} alt="" width={TILE} height={TILE} draggable={false} referrerPolicy="no-referrer" className="pointer-events-none absolute max-w-none" style={{ left: t.x, top: t.y }} />
      ))}
      <svg className="pointer-events-none absolute inset-0" width={width} height={height} aria-hidden>
        {grid.map((g, i) =>
          g.x !== undefined ? (
            <g key={i}>
              <line x1={g.x} x2={g.x} y1={0} y2={height} stroke="hsl(var(--border))" />
              <text x={g.x + 3} y={height - 6} fontSize="9" fill="hsl(var(--muted-foreground))">{g.label}</text>
            </g>
          ) : (
            <g key={i}>
              <line y1={g.y} y2={g.y} x1={0} x2={width} stroke="hsl(var(--border))" />
              <text x={4} y={(g.y || 0) - 3} fontSize="9" fill="hsl(var(--muted-foreground))">{g.label}</text>
            </g>
          ),
        )}
        {circles.map((c) => {
          const p = px(c.lat, c.lng);
          const r = c.radius / metersPerPixel(c.lat, v.z);
          return <circle key={c.id} cx={p.x} cy={p.y} r={Math.max(r, 3)} fill="hsl(var(--primary) / 0.10)" stroke="hsl(var(--primary))" strokeDasharray="5 4" strokeWidth={1.5} />;
        })}
        {route.length > 1 && (
          <polyline
            points={route.map(([lat, lng]) => { const p = px(lat, lng); return `${p.x},${p.y}`; }).join(" ")}
            fill="none"
            stroke="hsl(var(--primary))"
            strokeWidth={3}
            strokeLinejoin="round"
            strokeOpacity={0.8}
          />
        )}
      </svg>
      {markers.map((m) => {
        const p = px(m.lat, m.lng);
        if (p.x < -20 || p.y < -20 || p.x > width + 20 || p.y > height + 20) return null;
        const size = m.kind === "point" ? 8 : m.kind === "live" ? 18 : 14;
        return (
          <button
            key={m.id}
            type="button"
            title={m.label}
            aria-label={m.label}
            onClick={() => {
              setActive(m.id === active ? null : m.id);
              onSelect?.(m.id === active ? null : m.id);
            }}
            className={`absolute -translate-x-1/2 -translate-y-1/2 border-2 border-card shadow ${m.kind === "site" ? "rounded-sm" : "rounded-full"} ${m.kind === "live" ? "animate-pulse" : ""} ${active === m.id ? "ring-2 ring-foreground" : ""}`}
            style={{ left: p.x, top: p.y, width: size, height: size, background: toneColor[m.tone || (m.kind === "site" ? "blue" : "gray")] }}
          />
        );
      })}
      {current && (
        <div className="absolute left-3 top-3 max-w-[280px] rounded-lg border border-border bg-card p-3 text-xs shadow-lg">
          <p className="font-semibold">{current.label}</p>
          {current.detail}
        </div>
      )}
      <div className="absolute right-3 top-3 flex flex-col overflow-hidden rounded-lg border border-border bg-card shadow">
        <button type="button" aria-label="Zoom in" onClick={() => zoom(1)} className="p-2 hover:bg-muted"><Plus size={14} /></button>
        <button type="button" aria-label="Zoom out" onClick={() => zoom(-1)} className="border-t border-border p-2 hover:bg-muted"><Minus size={14} /></button>
        <button type="button" aria-label="Fit all locations" onClick={() => setView(null)} className="border-t border-border p-2 hover:bg-muted"><Maximize2 size={14} /></button>
      </div>
      <div className="pointer-events-none absolute bottom-2 left-3 flex items-end gap-1 text-[10px] text-muted-foreground">
        <span className="block h-1.5 border-x border-b border-muted-foreground" style={{ width: 100 }} />
        {scaleLabel}
      </div>
      <p className="pointer-events-none absolute bottom-1.5 right-2 rounded bg-card/80 px-1.5 text-[10px] text-muted-foreground">
        {tilesEnabled ? "© OpenStreetMap contributors" : "Coordinate grid · map tiles off"}
      </p>
      {!markers.length && !route.length && (
        <p className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">No recorded locations to show.</p>
      )}
    </div>
  );
}
