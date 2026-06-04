"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, Marker } from "leaflet";
import type { FriendLocation } from "@/hooks/useLocation";

type Props = {
  locations: Record<string, FriendLocation>;
  currentUid: string;
};

type LeafletModule = typeof import("leaflet");

const STAGES = [
  { name: "RAVE", emoji: "🔊", lat: 55.6889, lng: 12.6108 },
  { name: "FOREST", emoji: "🌲", lat: 55.6876, lng: 12.6115 },
  { name: "HANGAREN", emoji: "🏭", lat: 55.6895, lng: 12.6092 },
  { name: "OASIS", emoji: "🌊", lat: 55.6884, lng: 12.6101 },
  { name: "SUNRISE", emoji: "🌅", lat: 55.6880, lng: 12.6122 },
  { name: "SHADOW", emoji: "👤", lat: 55.6878, lng: 12.6135 },
  { name: "PODIUM", emoji: "🎤", lat: 55.6871, lng: 12.6112 },
  { name: "ENTRANCE", emoji: "🚪", lat: 55.6865, lng: 12.6095 },
  { name: "FIRST AID", emoji: "🏥", lat: 55.6893, lng: 12.6088 },
];

function getNearestStage(lat: number, lng: number): string {
  let nearest = STAGES[0];
  let minDist = Infinity;

  STAGES.forEach((stage) => {
    const d = Math.sqrt((lat - stage.lat) ** 2 + (lng - stage.lng) ** 2);
    if (d < minDist) {
      minDist = d;
      nearest = stage;
    }
  });

  const meters = minDist * 111000;
  return meters < 80 ? `${nearest.emoji} ${nearest.name}` : "📍 in giro";
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export default function Map({ locations, currentUid }: Props) {
  const mapRef = useRef<{ map: LeafletMap; L: LeafletModule } | null>(null);
  const markersRef = useRef<Record<string, Marker>>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const initVersionRef = useRef(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || mapRef.current) return;
    const initVersion = ++initVersionRef.current;
    let cancelled = false;

    import("leaflet").then((L) => {
      if (cancelled || initVersionRef.current !== initVersion || !containerRef.current || mapRef.current) return;
      const container = containerRef.current as HTMLDivElement & { _leaflet_id?: number };

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
        center: [55.6881, 12.613],
        zoom: 16,
        minZoom: 15,
        maxZoom: 19,
        maxBounds: [[55.68, 12.6], [55.696, 12.628]],
        zoomControl: false,
      });

      L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        { attribution: "© CartoDB" }
      ).addTo(map);

      STAGES.forEach((stage) => {
        const icon = L.divIcon({
          className: "",
          html: `
            <div style="
              background: rgba(0,0,0,0.75);
              border: 1px solid #CCFF00;
              color: #CCFF00;
              font-family: monospace;
              font-size: 9px;
              font-weight: 900;
              padding: 3px 6px;
              border-radius: 3px;
              white-space: nowrap;
              letter-spacing: 0.08em;
            ">${stage.emoji} ${stage.name}</div>
          `,
          iconAnchor: [30, 10],
        });

        L.marker([stage.lat, stage.lng], { icon, interactive: false }).addTo(map);
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
      if (containerRef.current) {
        const container = containerRef.current as HTMLDivElement & { _leaflet_id?: number };
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

  return (
    <div
      ref={containerRef}
      className="festival-map"
    />
  );
}

export { getNearestStage };
