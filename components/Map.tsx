"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, Marker, TileLayer } from "leaflet";
import type { FriendLocation } from "@/hooks/useLocation";

type MapStyle = "dark" | "light" | "satellite";

type Props = {
  locations: Record<string, FriendLocation>;
  currentUid: string;
  mapStyle: MapStyle;
  focusedLocation?: {
    lat: number;
    lng: number;
    focusId: number;
  } | null;
};

type LeafletModule = typeof import("leaflet");
type StylableZoneLayer = {
  setStyle?: (style: { weight: number; opacity: number }) => void;
  options?: {
    fillOpacity?: number;
  };
};

const TILE_LAYERS = {
  dark: {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution: "© CartoDB",
  },
  light: {
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    attribution: "© CartoDB",
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "© Esri",
  },
};

const LABEL_OFFSETS: Record<string, [number, number]> = {
  RAVE: [-0.0003, -0.0002],
  FOREST: [0.0001, 0],
  SUNRISE: [0, 0],
  SHADOW: [0, 0.0001],
  OASIS: [0.0001, -0.0001],
  "FOOD COURT": [0, 0],
  AWARENESS: [0.0001, 0],
};

const FESTIVAL_ZONES = [
  {
    name: "RAVE", emoji: "🔊", color: "#FF6B00", iconFile: "Rave_1.svg",
    coords: [[55.690336, 12.615492], [55.690806, 12.615843], [55.690593, 12.61705], [55.690067, 12.616754], [55.690332, 12.615509]] as [number, number][],
  },
  {
    name: "FOREST", emoji: "🌲", color: "#00FF88", iconFile: "Forest.svg",
    coords: [[55.689713, 12.616944], [55.689626, 12.617308], [55.689949, 12.617951], [55.690194, 12.617727], [55.690147, 12.617133], [55.689717, 12.616944]] as [number, number][],
  },
  {
    name: "SUNRISE", emoji: "🌅", color: "#FF00FF", iconFile: "Sunrise.svg",
    coords: [[55.690482, 12.618658], [55.690628, 12.61893], [55.690628, 12.61942], [55.690359, 12.619462], [55.690352, 12.618839], [55.690482, 12.618658]] as [number, number][],
  },
  {
    name: "SHADOW", emoji: "👤", color: "#00FFFF", iconFile: "Shadow.svg",
    coords: [[55.690494, 12.620119], [55.690411, 12.620581], [55.690257, 12.620539], [55.6903, 12.620084], [55.690497, 12.620119]] as [number, number][],
  },
  {
    name: "OASIS", emoji: "🌊", color: "#CCFF00", iconFile: "Oasis.svg",
    coords: [[55.690812, 12.617791], [55.690723, 12.617696], [55.690636, 12.61797], [55.690761, 12.618172], [55.690868, 12.617989], [55.690812, 12.617791]] as [number, number][],
  },
  {
    name: "FOOD COURT", emoji: "🍔", color: "#FFD700", iconFile: "Food court.svg",
    coords: [[55.69109, 12.617724], [55.691029, 12.618696], [55.691257, 12.618874], [55.691316, 12.618219], [55.691367, 12.61768], [55.69109, 12.617708]] as [number, number][],
  },
  {
    name: "AWARENESS", emoji: "🏥", color: "#FF4444", iconFile: "Awareness.svg",
    coords: [[55.690923, 12.616165], [55.691157, 12.616317], [55.691181, 12.616044], [55.690953, 12.61594], [55.690923, 12.616159]] as [number, number][],
  },
];

const POIS = [
  { name: "BAR", emoji: "🍺", iconFile: "Bar.svg", lat: 55.690873, lng: 12.617855 },
  { name: "BAR", emoji: "🍺", iconFile: "Bar.svg", lat: 55.689738, lng: 12.617685 },
  { name: "WC", emoji: "🚻", iconFile: "WC.svg", lat: 55.689934, lng: 12.616594 },
  { name: "LOCKERS", emoji: "🔒", iconFile: "Lockers.svg", lat: 55.689957, lng: 12.615269 },
  { name: "ENTRANCE", emoji: "🚪", iconFile: "Entrance.svg", lat: 55.689672, lng: 12.615095 },
  { name: "WATER", emoji: "💧", iconFile: "Water.svg", lat: 55.690488, lng: 12.617131 },
  { name: "WATER", emoji: "💧", iconFile: "Water.svg", lat: 55.691081, lng: 12.616684 },
];

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

export default function Map({ locations, currentUid, mapStyle, focusedLocation }: Props) {
  const mapRef = useRef<{ map: LeafletMap; L: LeafletModule } | null>(null);
  const markersRef = useRef<Record<string, Marker>>({});
  const labelMarkersRef = useRef<Marker[]>([]);
  const poiMarkersRef = useRef<Marker[]>([]);
  const tileLayerRef = useRef<TileLayer | null>(null);
  const mapStyleRef = useRef(mapStyle);
  const containerRef = useRef<HTMLDivElement>(null);
  const initVersionRef = useRef(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    mapStyleRef.current = mapStyle;
  }, [mapStyle]);

  useEffect(() => {
    if (typeof window === "undefined" || mapRef.current) return;
    const containerElement = containerRef.current;
    const initVersion = ++initVersionRef.current;
    let cancelled = false;
    let updateVisibilityByZoom: (() => void) | null = null;

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

      const tileLayer = TILE_LAYERS[mapStyleRef.current];
      tileLayerRef.current = L.tileLayer(tileLayer.url, {
        attribution: tileLayer.attribution,
      }).addTo(map);

      FESTIVAL_ZONES.forEach((zone) => {
        L.polygon(zone.coords, {
          color: zone.color,
          fillColor: zone.color,
          fillOpacity: 0.08,
          weight: 1,
          opacity: 0.25,
          interactive: false,
        }).addTo(map);

        const latC = zone.coords.reduce((s, p) => s + p[0], 0) / zone.coords.length;
        const lngC = zone.coords.reduce((s, p) => s + p[1], 0) / zone.coords.length;
        const offset = LABEL_OFFSETS[zone.name] ?? [0, 0];
        const finalLat = latC + offset[0];
        const finalLng = lngC + offset[1];
        const labelIcon = L.divIcon({
          className: "",
          html: `<div style="
  color: ${zone.color};
  font-family: monospace;
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.12em;
  text-shadow: 0 0 10px ${zone.color}, 0 0 20px ${zone.color}88;
  white-space: nowrap;
  pointer-events: none;
  text-align: center;
  line-height: 1.4;
">${zone.emoji}<br>${zone.name}</div>`,
          iconAnchor: [24, 16],
        });
        const labelMarker = L.marker([finalLat, finalLng], {
          icon: labelIcon,
          interactive: false,
        }).addTo(map);
        labelMarkersRef.current.push(labelMarker);
      });

      POIS.forEach((poi) => {
        const name = escapeHtml(poi.name);
        const icon = L.divIcon({
          className: "",
          html: `<div style="
  font-size: 18px;
  filter: drop-shadow(0 0 4px rgba(255,255,255,0.6));
  pointer-events: none;
  line-height: 1;
">${poi.emoji}</div>`,
          iconSize: [18, 18],
          iconAnchor: [9, 9],
        });
        const poiMarker = L.marker([poi.lat, poi.lng], {
          icon,
          interactive: false,
        }).addTo(map);
        poiMarker.bindTooltip(name, {
          permanent: false,
          direction: "top",
          className: "festival-tooltip",
          offset: [0, -10],
        });
        poiMarkersRef.current.push(poiMarker);
      });

      updateVisibilityByZoom = () => {
        const zoom = map.getZoom();
        labelMarkersRef.current.forEach((marker) => {
          const el = marker.getElement();
          if (!el) return;
          el.style.display = zoom >= 16 ? "block" : "none";
        });
        poiMarkersRef.current.forEach((marker) => {
          const el = marker.getElement();
          if (!el) return;
          el.style.display = zoom >= 17 ? "block" : "none";
        });
        map.eachLayer((layer) => {
          const zoneLayer = layer as StylableZoneLayer;
          if (!zoneLayer.setStyle || zoneLayer.options?.fillOpacity === undefined) return;

          const weight = zoom >= 17 ? 2 : zoom >= 16 ? 1.5 : 1;
          const opacity = zoom >= 16 ? 0.5 : 0.25;
          zoneLayer.setStyle({ weight, opacity });
        });
      };

      map.on("zoomend", updateVisibilityByZoom);
      updateVisibilityByZoom();

      mapRef.current = { map, L };
      setReady(true);
    });

    return () => {
      cancelled = true;
      if (mapRef.current?.map) {
        if (updateVisibilityByZoom) {
          mapRef.current.map.off("zoomend", updateVisibilityByZoom);
        }
        mapRef.current.map.remove();
        mapRef.current = null;
      }
      if (containerElement) {
        const container = containerElement as HTMLDivElement & { _leaflet_id?: number };
        delete container._leaflet_id;
        container.replaceChildren();
      }
      markersRef.current = {};
      labelMarkersRef.current = [];
      poiMarkersRef.current = [];
      tileLayerRef.current = null;
      setReady(false);
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current || !tileLayerRef.current) return;
    const { map, L } = mapRef.current;
    const tileLayer = TILE_LAYERS[mapStyle];

    tileLayerRef.current.remove();
    tileLayerRef.current = L.tileLayer(tileLayer.url, {
      attribution: tileLayer.attribution,
    }).addTo(map);
  }, [mapStyle]);

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
