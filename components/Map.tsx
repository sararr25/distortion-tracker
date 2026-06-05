"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, Marker } from "leaflet";
import type { FriendLocation } from "@/hooks/useLocation";

type Props = {
  locations: Record<string, FriendLocation>;
  currentUid: string;
  focusedLocation?: {
    lat: number;
    lng: number;
    focusId: number;
  } | null;
};

type LeafletModule = typeof import("leaflet");

const FESTIVAL_ZONES = [
  {
    name: "RAVE", emoji: "🔊", color: "#FF6B00", iconFile: "Rave_1.svg",
    labelOffset: [-0.0001, -0.00018] as [number, number],
    coords: [[55.690336, 12.615492], [55.690806, 12.615843], [55.690593, 12.61705], [55.690067, 12.616754], [55.690332, 12.615509]] as [number, number][],
  },
  {
    name: "FOREST", emoji: "🌲", color: "#00FF88", iconFile: "Forest.svg",
    labelOffset: [-0.00028, -0.00036] as [number, number],
    coords: [[55.689713, 12.616944], [55.689626, 12.617308], [55.689949, 12.617951], [55.690194, 12.617727], [55.690147, 12.617133], [55.689717, 12.616944]] as [number, number][],
  },
  {
    name: "SUNRISE", emoji: "🌅", color: "#FF00FF", iconFile: "Sunrise.svg",
    labelOffset: [0, 0.00016] as [number, number],
    coords: [[55.690482, 12.618658], [55.690628, 12.61893], [55.690628, 12.61942], [55.690359, 12.619462], [55.690352, 12.618839], [55.690482, 12.618658]] as [number, number][],
  },
  {
    name: "SHADOW", emoji: "👤", color: "#00FFFF", iconFile: "Shadow.svg",
    labelOffset: [0, 0.00018] as [number, number],
    coords: [[55.690494, 12.620119], [55.690411, 12.620581], [55.690257, 12.620539], [55.6903, 12.620084], [55.690497, 12.620119]] as [number, number][],
  },
  {
    name: "OASIS", emoji: "🌊", color: "#CCFF00", iconFile: "Oasis.svg",
    labelOffset: [-0.00004, -0.00034] as [number, number],
    coords: [[55.690812, 12.617791], [55.690723, 12.617696], [55.690636, 12.61797], [55.690761, 12.618172], [55.690868, 12.617989], [55.690812, 12.617791]] as [number, number][],
  },
  {
    name: "FOOD COURT", emoji: "🍔", color: "#FFD700", iconFile: "Food court.svg",
    labelOffset: [0.00028, 0.0003] as [number, number],
    coords: [[55.69109, 12.617724], [55.691029, 12.618696], [55.691257, 12.618874], [55.691316, 12.618219], [55.691367, 12.61768], [55.69109, 12.617708]] as [number, number][],
  },
  {
    name: "AWARENESS", emoji: "🏥", color: "#FF4444", iconFile: "Awareness.svg",
    labelOffset: [0.0002, 0.00002] as [number, number],
    coords: [[55.690923, 12.616165], [55.691157, 12.616317], [55.691181, 12.616044], [55.690953, 12.61594], [55.690923, 12.616159]] as [number, number][],
  },
];

const POIS = [
  { name: "BAR", emoji: "🍺", iconFile: "Bar.svg", lat: 55.690873, lng: 12.617855, labelOffset: [-0.00022, 0.00032] as [number, number] },
  { name: "BAR", emoji: "🍺", iconFile: "Bar.svg", lat: 55.689738, lng: 12.617685, labelOffset: [-0.0003, 0.00028] as [number, number] },
  { name: "WC", emoji: "🚻", iconFile: "WC.svg", lat: 55.689934, lng: 12.616594, labelOffset: [-0.00018, -0.00018] as [number, number] },
  { name: "LOCKERS", emoji: "🔒", iconFile: "Lockers.svg", lat: 55.689957, lng: 12.615269, labelOffset: [0.00018, 0.00014] as [number, number] },
  { name: "ENTRANCE", emoji: "🚪", iconFile: "Entrance.svg", lat: 55.689672, lng: 12.615095, labelOffset: [-0.00018, -0.00008] as [number, number] },
  { name: "WATER", emoji: "💧", iconFile: "Water.svg", lat: 55.690488, lng: 12.617131, labelOffset: [0.00014, -0.00018] as [number, number] },
  { name: "WATER", emoji: "💧", iconFile: "Water.svg", lat: 55.691081, lng: 12.616684, labelOffset: [0.00018, 0.00022] as [number, number] },
];

const POI_COLORS: Record<string, string> = {
  BAR: "#FFD700",
  WC: "#FFFFFF",
  LOCKERS: "#D1BCFF",
  ENTRANCE: "#00FF88",
  WATER: "#7DF4FF",
};

function getNearestStage(lat: number, lng: number): string {
  const stages = [
    { name: "🔊 RAVE", lat: 55.690427, lng: 12.616130 },
    { name: "🌲 FOREST", lat: 55.689891, lng: 12.617335 },
    { name: "🌅 SUNRISE", lat: 55.690488, lng: 12.618994 },
    { name: "👤 SHADOW", lat: 55.690392, lng: 12.620288 },
    { name: "🌊 OASIS", lat: 55.690769, lng: 12.617902 },
    { name: "🍔 FOOD COURT", lat: 55.691192, lng: 12.618150 },
    { name: "🏥 AWARENESS", lat: 55.691258, lng: 12.616473 },
  ];
  let nearest = stages[0];
  let minDist = Infinity;
  stages.forEach((s) => {
    const d = Math.sqrt((lat - s.lat) ** 2 + (lng - s.lng) ** 2);
    if (d < minDist) {
      minDist = d;
      nearest = s;
    }
  });
  const meters = minDist * 111000;
  return meters < 120 ? nearest.name : "📍 in giro";
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function iconAssetUrl(fileName: string) {
  return `/icons-zone/${encodeURIComponent(fileName)}`;
}

function shiftedCoords(lat: number, lng: number, offset?: [number, number]): [number, number] {
  return [lat + (offset?.[0] ?? 0), lng + (offset?.[1] ?? 0)];
}

export default function Map({ locations, currentUid, focusedLocation }: Props) {
  const mapRef = useRef<{ map: LeafletMap; L: LeafletModule } | null>(null);
  const markersRef = useRef<Record<string, Marker>>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const initVersionRef = useRef(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || mapRef.current) return;
    const containerElement = containerRef.current;
    const initVersion = ++initVersionRef.current;
    let cancelled = false;

    import("leaflet").then((L) => {
      if (cancelled || initVersionRef.current !== initVersion || !containerElement || mapRef.current) return;
      const container = containerElement as HTMLDivElement & { _leaflet_id?: number };

      if (container._leaflet_id) {
        delete container._leaflet_id;
        container.replaceChildren();
      }

      // fix icone leaflet con next.js
      delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });

      const map = L.map(container, {
        center: [55.6904, 12.6175],
        zoom: 16,
        minZoom: 15,
        maxZoom: 19,
        maxBounds: [[55.688, 12.613], [55.693, 12.623]],
        zoomControl: false,
      });

      L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        { attribution: "© CartoDB" }
      ).addTo(map);

      FESTIVAL_ZONES.forEach((zone) => {
        L.polygon(zone.coords, {
          color: zone.color,
          fillColor: zone.color,
          fillOpacity: 0.13,
          weight: 1.5,
          opacity: 0.55,
          interactive: false,
        }).addTo(map);

        const latC = zone.coords.reduce((s, p) => s + p[0], 0) / zone.coords.length;
        const lngC = zone.coords.reduce((s, p) => s + p[1], 0) / zone.coords.length;
        const iconOnly = zone.name === "AWARENESS";
        const iconSize = iconOnly ? 92 : 76;
        const markerSize: [number, number] = iconOnly ? [92, 92] : [126, 108];
        const markerAnchor: [number, number] = iconOnly ? [46, 46] : [63, 54];
        const labelHtml = iconOnly
          ? `<img src="${iconAssetUrl(zone.iconFile)}" alt="" title="FIRST AID" style="width:${iconSize}px;height:${iconSize}px;object-fit:contain;filter:drop-shadow(0 0 10px ${zone.color});pointer-events:none;" />`
          : `<div style="display:grid;width:126px;justify-items:center;gap:3px;color:${zone.color};font-family:monospace;font-size:11px;font-weight:900;letter-spacing:0.1em;text-align:center;text-shadow:0 0 8px ${zone.color};white-space:nowrap;pointer-events:none;"><img src="${iconAssetUrl(zone.iconFile)}" alt="" style="width:${iconSize}px;height:${iconSize}px;object-fit:contain;filter:drop-shadow(0 0 8px ${zone.color});" /><span>${zone.name}</span></div>`;

        L.marker(shiftedCoords(latC, lngC, zone.labelOffset), {
          interactive: false,
          icon: L.divIcon({
            className: "",
            html: labelHtml,
            iconSize: markerSize,
            iconAnchor: markerAnchor,
          }),
        }).addTo(map);
      });

      POIS.forEach((poi) => {
        const color = POI_COLORS[poi.name] ?? "#FFFFFF";
        const name = escapeHtml(poi.name);
        const iconUrl = iconAssetUrl(poi.iconFile);
        const iconOnly = poi.name === "WATER";
        const markerSize: [number, number] = iconOnly ? [84, 84] : [162, 84];
        const markerAnchor: [number, number] = iconOnly ? [42, 42] : [81, 42];
        const labelHtml = iconOnly
          ? `<img src="${iconUrl}" alt="" title="${name}" style="width:84px;height:84px;object-fit:contain;filter:drop-shadow(0 0 10px ${color});pointer-events:none;" />`
          : `<div style="display:flex;width:162px;align-items:center;justify-content:center;gap:7px;background:rgba(0,0,0,0.84);border:1px solid ${color};color:${color};font-family:monospace;font-size:11px;font-weight:900;letter-spacing:0.08em;padding:5px 8px;border-radius:3px;white-space:nowrap;box-shadow:0 0 8px rgba(0,0,0,0.75),0 0 6px ${color};pointer-events:none;" title="${name}"><img src="${iconUrl}" alt="" style="width:68px;height:68px;object-fit:contain;" />${name}</div>`;

        L.marker(shiftedCoords(poi.lat, poi.lng, poi.labelOffset), {
          interactive: false,
          icon: L.divIcon({
            className: "",
            html: labelHtml,
            iconSize: markerSize,
            iconAnchor: markerAnchor,
          }),
        }).addTo(map);
      });

      mapRef.current = { map, L };
      setReady(true);
    });

    return () => {
      cancelled = true;
      if (mapRef.current?.map) {
        mapRef.current.map.remove();
        mapRef.current = null;
      }
      if (containerElement) {
        const container = containerElement as HTMLDivElement & { _leaflet_id?: number };
        delete container._leaflet_id;
        container.replaceChildren();
      }
      markersRef.current = {};
      setReady(false);
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current || !ready) return;
    const { map, L } = mapRef.current;

    const COLORS = ["#c3f400", "#7df4ff", "#ffffff", "#d1bcff", "#00dbe9"];
    let colorIndex = 0;
    const activeUids = new Set<string>();

    Object.entries(locations).forEach(([uid, loc]) => {
      // salta posizioni vecchie di più di 10 minuti
      if (Date.now() - loc.updatedAt > 10 * 60 * 1000) return;

      activeUids.add(uid);
      const isMe = uid === currentUid;
      const color = isMe ? "#c3f400" : COLORS[colorIndex++ % COLORS.length];
      const label = escapeHtml(isMe ? "TU" : loc.name.split(" ")[0] || "Guest");
      const emoji = escapeHtml(loc.emoji);

      const icon = L.divIcon({
        className: "",
        html: `
          <div style="
            background: ${color};
            color: #000;
            border-radius: 50%;
            width: 36px;
            height: 36px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 18px;
            font-weight: 900;
            box-shadow: 0 0 12px ${color};
            border: 2px solid #000;
          ">${emoji}</div>
          <div style="
            color: ${color};
            font-size: 11px;
            font-weight: 700;
            text-align: center;
            margin-top: 2px;
            text-shadow: 0 0 6px ${color};
            white-space: nowrap;
          ">${label}</div>
        `,
        iconAnchor: [18, 18],
      });

      if (markersRef.current[uid]) {
        markersRef.current[uid].setLatLng([loc.lat, loc.lng]);
        markersRef.current[uid].setIcon(icon);
      } else {
        markersRef.current[uid] = L.marker([loc.lat, loc.lng], { icon }).addTo(map);
      }
    });

    Object.entries(markersRef.current).forEach(([uid, marker]) => {
      if (activeUids.has(uid)) return;
      marker.removeFrom(map);
      delete markersRef.current[uid];
    });
  }, [locations, currentUid, ready]);

  useEffect(() => {
    if (!mapRef.current || !ready || !focusedLocation) return;
    mapRef.current.map.flyTo([focusedLocation.lat, focusedLocation.lng], 18, {
      animate: true,
      duration: 0.75,
    });
  }, [focusedLocation, ready]);

  return (
    <div
      ref={containerRef}
      className="festival-map"
    />
  );
}

export { getNearestStage };
