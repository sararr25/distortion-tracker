"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, Marker, TileLayer } from "leaflet";
import type { FriendLocation } from "@/hooks/useLocation";

type MapStyle = "dark" | "light" | "satellite";
type MeetingPointMarker = {
  lat: number;
  lng: number;
  label: string;
};

type Props = {
  locations: Record<string, FriendLocation>;
  currentUid: string;
  mapStyle: MapStyle;
  meetingPoint: MeetingPointMarker | null;
  onMapReady?: (flyTo: (lat: number, lng: number) => void) => void;
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

type ZoneLabelMode = "horizontal" | "stacked";

type FestivalZone = {
  name: string;
  emoji: string;
  color: string;
  iconFile: string;
  labelMode: ZoneLabelMode;
  labelPosition: [number, number];
  coords: [number, number][];
};

type FestivalPoi = {
  name: string;
  emoji: string;
  asset: string;
  lat: number;
  lng: number;
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

const TILE_LAYER_CLASSES: Record<MapStyle, string> = {
  dark: "festival-tiles festival-tiles--dark",
  light: "festival-tiles festival-tiles--light",
  satellite: "festival-tiles festival-tiles--satellite",
};

function getZoomScale(zoom: number): number {
  return Math.pow(1.6, zoom - 16);
}

const FESTIVAL_ZONES: FestivalZone[] = [
  {
    name: "RAVE", emoji: "🔊", color: "#FF6B00", iconFile: "Rave_1.svg", labelMode: "horizontal", labelPosition: [55.69046, 12.61618],
    coords: [[55.690336, 12.615492], [55.690806, 12.615843], [55.690593, 12.61705], [55.690067, 12.616754], [55.690332, 12.615509]] as [number, number][],
  },
  {
    name: "FOREST", emoji: "🌲", color: "#00FF88", iconFile: "Forest.svg", labelMode: "horizontal", labelPosition: [55.6899, 12.6174],
    coords: [[55.689713, 12.616944], [55.689626, 12.617308], [55.689949, 12.617951], [55.690194, 12.617727], [55.690147, 12.617133], [55.689717, 12.616944]] as [number, number][],
  },
  {
    name: "SUNRISE", emoji: "🌅", color: "#FF00FF", iconFile: "Sunrise.svg", labelMode: "horizontal", labelPosition: [55.6905, 12.61904],
    coords: [[55.690482, 12.618658], [55.690628, 12.61893], [55.690628, 12.61942], [55.690359, 12.619462], [55.690352, 12.618839], [55.690482, 12.618658]] as [number, number][],
  },
  {
    name: "SHADOW", emoji: "👤", color: "#00FFFF", iconFile: "Shadow.svg", labelMode: "stacked", labelPosition: [55.69039, 12.62031],
    coords: [[55.690494, 12.620119], [55.690411, 12.620581], [55.690257, 12.620539], [55.6903, 12.620084], [55.690497, 12.620119]] as [number, number][],
  },
  {
    name: "OASIS", emoji: "🌊", color: "#CCFF00", iconFile: "Oasis.svg", labelMode: "stacked", labelPosition: [55.69075, 12.61792],
    coords: [[55.690812, 12.617791], [55.690723, 12.617696], [55.690636, 12.61797], [55.690761, 12.618172], [55.690868, 12.617989], [55.690812, 12.617791]] as [number, number][],
  },
  {
    name: "FOOD COURT", emoji: "🍔", color: "#FFD700", iconFile: "Food court.svg", labelMode: "horizontal", labelPosition: [55.69117, 12.61831],
    coords: [[55.69109, 12.617724], [55.691029, 12.618696], [55.691257, 12.618874], [55.691316, 12.618219], [55.691367, 12.61768], [55.69109, 12.617708]] as [number, number][],
  },
  {
    name: "AWARENESS", emoji: "🏥", color: "#FF4444", iconFile: "Awareness.svg", labelMode: "horizontal", labelPosition: [55.69103, 12.61617],
    coords: [[55.690923, 12.616165], [55.691157, 12.616317], [55.691181, 12.616044], [55.690953, 12.61594], [55.690923, 12.616159]] as [number, number][],
  },
];

const POIS: FestivalPoi[] = [
  { name: "HANGAREN", emoji: "🏭", asset: "stage.png", lat: 55.6909, lng: 12.6095 },
  { name: "RAVE", emoji: "🔊", asset: "stage.png", lat: 55.6897, lng: 12.6134 },
  { name: "OASIS", emoji: "🌊", asset: "stage.png", lat: 55.6891, lng: 12.6174 },
  { name: "SUNRISE", emoji: "🌅", asset: "stage.png", lat: 55.6889, lng: 12.6203 },
  { name: "FOREST", emoji: "🌲", asset: "stage.png", lat: 55.6883, lng: 12.6148 },
  { name: "SHADOW", emoji: "👤", asset: "stage.png", lat: 55.6889, lng: 12.6240 },
  { name: "ENTRANCE", emoji: "🚪", asset: "entrance.png", lat: 55.6864, lng: 12.6106 },
  { name: "LOCKERS", emoji: "🔒", asset: "lockers.png", lat: 55.6875, lng: 12.6067 },
  { name: "FIRST AID", emoji: "🏥", asset: "firstaid.png", lat: 55.6905, lng: 12.6115 },
  { name: "KIOSK", emoji: "🛒", asset: "kiosk.png", lat: 55.6878, lng: 12.6161 },
  { name: "WC", emoji: "🚻", asset: "wc.png", lat: 55.6908, lng: 12.6095 },
  { name: "WC", emoji: "🚻", asset: "wc.png", lat: 55.6905, lng: 12.6100 },
  { name: "WC", emoji: "🚻", asset: "wc.png", lat: 55.6870, lng: 12.6144 },
  { name: "WC", emoji: "🚻", asset: "wc.png", lat: 55.6870, lng: 12.6214 },
  { name: "WATER", emoji: "💧", asset: "water.png", lat: 55.6888, lng: 12.6131 },
  { name: "WATER", emoji: "💧", asset: "water.png", lat: 55.6875, lng: 12.6125 },
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
  return meters < 120 ? nearest.name : "📍 around";
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

function getZoneLabelMetrics(zoom: number, isMobile: boolean, mode: ZoneLabelMode, name: string) {
  const textSize = isMobile
    ? Math.min(12, Math.max(9, 8 + (zoom - 15)))
    : Math.min(14, Math.max(11, 10 + (zoom - 16)));
  const iconSize = mode === "stacked"
    ? (isMobile ? Math.min(30, Math.max(22, 20 + (zoom - 15))) : Math.min(32, Math.max(24, 22 + (zoom - 16))))
    : (isMobile ? Math.min(28, Math.max(21, 19 + (zoom - 15))) : Math.min(30, Math.max(23, 21 + (zoom - 16))));
  const gap = isMobile ? 2 : 3;
  const padX = mode === "stacked" ? (isMobile ? 7 : 8) : (isMobile ? 8 : 10);
  const padY = mode === "stacked" ? (isMobile ? 5 : 6) : (isMobile ? 4 : 5);
  const width = mode === "stacked"
    ? Math.max(48, iconSize + 6)
    : Math.max(72, Math.round(name.length * textSize * 0.58 + iconSize + 6));
  const height = mode === "stacked"
    ? Math.max(44, iconSize + textSize + gap + 2)
    : Math.max(26, Math.max(iconSize, Math.round(textSize * 1.3 + 2)));

  return { textSize, iconSize, gap, padX, padY, width, height };
}

function getPoiSize(zoom: number) {
  const scale = getZoomScale(zoom);
  const iconSize = Math.round(40 * scale);
  return Math.max(20, Math.min(56, iconSize));
}

export default function Map({ locations, currentUid, mapStyle, meetingPoint, onMapReady, focusedLocation }: Props) {
  const mapRef = useRef<{ map: LeafletMap; L: LeafletModule } | null>(null);
  const markersRef = useRef<Record<string, Marker>>({});
  const meetingMarkerRef = useRef<Marker | null>(null);
  const labelMarkersRef = useRef<{ marker: Marker; zone: typeof FESTIVAL_ZONES[number] }[]>([]);
  const poiMarkersRef = useRef<{ marker: Marker; poi: typeof POIS[number] }[]>([]);
  const tileLayerRef = useRef<TileLayer | null>(null);
  const tilePaneRef = useRef<HTMLElement | null>(null);
  const mapStyleRef = useRef(mapStyle);
  const containerRef = useRef<HTMLDivElement>(null);
  const initVersionRef = useRef(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    mapStyleRef.current = mapStyle;
  }, [mapStyle]);

  const updateMarkerSizes = (map: LeafletMap, L: LeafletModule) => {
    const zoom = map.getZoom();
    const scale = getZoomScale(zoom);
    const isMobile = typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches;

    labelMarkersRef.current.forEach(({ marker, zone }) => {
      const metrics = getZoneLabelMetrics(zoom, isMobile, zone.labelMode, zone.name);
      const escapedName = escapeHtml(zone.name);
      marker.setIcon(L.divIcon({
        className: `festival-zone-label festival-zone-label--${zone.labelMode}`,
        html: `<div class="festival-zone-label__inner festival-zone-label__inner--${zone.labelMode}" style="--zone-color: ${zone.color}; --zone-text-size: ${metrics.textSize}px; --zone-icon-size: ${metrics.iconSize}px; --zone-gap: ${metrics.gap}px; --zone-pad-x: ${metrics.padX}px; --zone-pad-y: ${metrics.padY}px; --zone-width: ${metrics.width}px; --zone-height: ${metrics.height}px;">
  <img class="festival-zone-label__icon" src="${iconAssetUrl(zone.iconFile)}" alt="" />
  <span class="festival-zone-label__text">${escapedName}</span>
</div>`,
        iconSize: [metrics.width, metrics.height],
        iconAnchor: [Math.round(metrics.width / 2), Math.round(metrics.height / 2)],
      }));
    });

    poiMarkersRef.current.forEach(({ marker, poi }) => {
      const clampedSize = getPoiSize(zoom);
      const shadowSize = Math.max(4, Math.round(6 * scale));
      const html = poi.asset
        ? `<div class="festival-poi-marker__inner" style="--poi-size: ${clampedSize}px; --poi-glow: ${shadowSize}px;">
  <img class="festival-poi-marker__icon" src="${iconAssetUrl(poi.asset)}" alt="" />
</div>`
        : `<div class="festival-poi-marker__inner festival-poi-marker__inner--emoji" style="--poi-size: ${clampedSize}px; --poi-glow: ${shadowSize}px;">${poi.emoji}</div>`;

      marker.setIcon(L.divIcon({
        className: `festival-poi-marker festival-poi-marker--${poi.name.toLowerCase()}`,
        html,
        iconSize: [clampedSize, clampedSize],
        iconAnchor: [Math.round(clampedSize / 2), Math.round(clampedSize / 2)],
      }));
    });
  };

  useEffect(() => {
    if (typeof window === "undefined" || mapRef.current) return;
    const containerElement = containerRef.current;
    const initVersion = ++initVersionRef.current;
    let cancelled = false;
    let updateZonesByZoom: (() => void) | null = null;
    let updateMarkersByZoom: (() => void) | null = null;
    let saveMapView: (() => void) | null = null;

    import("leaflet").then((L) => {
      if (cancelled || initVersionRef.current !== initVersion || !containerElement || mapRef.current) return;
      const container = containerElement as HTMLDivElement & { _leaflet_id?: number };

      if (container._leaflet_id) {
        delete container._leaflet_id;
        container.replaceChildren();
      }

      // Fix Leaflet's default icon URLs when bundled by Next.js.
      delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });

      const savedLat = Number.parseFloat(window.localStorage.getItem("distortion_map_lat") ?? "");
      const savedLng = Number.parseFloat(window.localStorage.getItem("distortion_map_lng") ?? "");
      const savedZoom = Number.parseInt(window.localStorage.getItem("distortion_map_zoom") ?? "", 10);
      const hasSavedCenter =
        !Number.isNaN(savedLat) &&
        !Number.isNaN(savedLng) &&
        savedLat >= 55.680 &&
        savedLat <= 55.696 &&
        savedLng >= 12.600 &&
        savedLng <= 12.628;
      const initialCenter: [number, number] = hasSavedCenter
        ? [savedLat, savedLng]
        : [55.6904, 12.6175];
      const initialZoom =
        !Number.isNaN(savedZoom) && savedZoom >= 15 && savedZoom <= 19
          ? savedZoom
          : 16;

      const map = L.map(container, {
        center: initialCenter,
        zoom: initialZoom,
        minZoom: 15,
        maxZoom: 19,
        maxBounds: [[55.688, 12.613], [55.693, 12.623]],
        zoomControl: false,
      });
      tilePaneRef.current = map.getPane("tilePane") ?? null;
      if (tilePaneRef.current) {
        tilePaneRef.current.style.filter = mapStyleRef.current === "dark"
          ? "contrast(1.3) brightness(1.4)"
          : "none";
      }

      saveMapView = () => {
        const center = map.getCenter();
        try {
          window.localStorage.setItem("distortion_map_lat", center.lat.toString());
          window.localStorage.setItem("distortion_map_lng", center.lng.toString());
          window.localStorage.setItem("distortion_map_zoom", map.getZoom().toString());
        } catch (error) {
          console.warn("Map position save failed:", error);
        }
      };
      map.on("moveend", saveMapView);
      map.on("zoomend", saveMapView);

      const tileLayer = TILE_LAYERS[mapStyleRef.current];
      tileLayerRef.current = L.tileLayer(tileLayer.url, {
        attribution: tileLayer.attribution,
        className: TILE_LAYER_CLASSES[mapStyleRef.current],
      }).addTo(map);

      const paneDefinitions: Array<[string, number]> = [
        ["festival-zones", 350],
        ["festival-labels", 400],
        ["festival-pois", 450],
        ["festival-friends", 500],
        ["festival-meeting", 550],
      ];

      paneDefinitions.forEach(([paneName, zIndex]) => {
        if (!map.getPane(paneName)) {
          map.createPane(paneName);
        }
        const pane = map.getPane(paneName);
        if (pane) {
          pane.style.zIndex = String(zIndex);
        }
      });

      FESTIVAL_ZONES.forEach((zone) => {
        L.polygon(zone.coords, {
          color: zone.color,
          fillColor: zone.color,
          fillOpacity: 0.08,
          weight: 1,
          opacity: 0.25,
          interactive: false,
          pane: "festival-zones",
        }).addTo(map);

        const [finalLat, finalLng] = zone.labelPosition;
        const labelMarker = L.marker([finalLat, finalLng], {
          icon: L.divIcon({ className: "festival-zone-label", html: "" }),
          interactive: false,
          pane: "festival-labels",
        }).addTo(map);
        labelMarkersRef.current.push({ marker: labelMarker, zone });
      });

      POIS.forEach((poi) => {
        const name = escapeHtml(poi.name);
        const clampedSize = getPoiSize(map.getZoom());
        const poiMarker = L.marker([poi.lat, poi.lng], {
          icon: L.divIcon({ className: "festival-poi-marker", html: "" }),
          interactive: true,
          pane: "festival-pois",
        }).addTo(map);
        poiMarker.on("click", () => {
          const currentZoom = map.getZoom();
          const targetZoom = Math.max(currentZoom, 18);
          map.flyTo([poi.lat, poi.lng], targetZoom, {
            animate: true,
            duration: 0.6,
          });
        });
        poiMarker.bindTooltip(name, {
          permanent: false,
          direction: "top",
          className: "festival-tooltip",
          offset: [0, -clampedSize / 2 - 4],
        });
        poiMarkersRef.current.push({ marker: poiMarker, poi });
      });

      updateZonesByZoom = () => {
        const zoom = map.getZoom();
        map.eachLayer((layer) => {
          const zoneLayer = layer as StylableZoneLayer;
          if (!zoneLayer.setStyle || zoneLayer.options?.fillOpacity === undefined) return;

          const weight = zoom >= 17 ? 2 : zoom >= 16 ? 1.5 : 1;
          const opacity = zoom >= 16 ? 0.5 : 0.25;
          zoneLayer.setStyle({ weight, opacity });
        });
      };
      updateMarkersByZoom = () => updateMarkerSizes(map, L);

      updateZonesByZoom();
      updateMarkerSizes(map, L);
      map.on("zoomend", updateZonesByZoom);
      map.on("zoomend", updateMarkersByZoom);

      mapRef.current = { map, L };
      onMapReady?.((lat, lng) => map.flyTo([lat, lng], 17, { animate: true, duration: 0.8 }));
      setReady(true);
    });

    return () => {
      cancelled = true;
      if (mapRef.current?.map) {
        if (updateZonesByZoom) {
          mapRef.current.map.off("zoomend", updateZonesByZoom);
        }
        if (updateMarkersByZoom) {
          mapRef.current.map.off("zoomend", updateMarkersByZoom);
        }
        if (saveMapView) {
          mapRef.current.map.off("moveend", saveMapView);
          mapRef.current.map.off("zoomend", saveMapView);
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
      meetingMarkerRef.current = null;
      labelMarkersRef.current = [];
      poiMarkersRef.current = [];
      tileLayerRef.current = null;
      tilePaneRef.current = null;
      setReady(false);
    };
  }, [onMapReady]);

  useEffect(() => {
    if (!mapRef.current || !tileLayerRef.current) return;
    const { map, L } = mapRef.current;
    const tileLayer = TILE_LAYERS[mapStyle];

    tileLayerRef.current.remove();
    tileLayerRef.current = L.tileLayer(tileLayer.url, {
      attribution: tileLayer.attribution,
      className: TILE_LAYER_CLASSES[mapStyle],
    }).addTo(map);
    if (tilePaneRef.current) {
      tilePaneRef.current.style.filter = mapStyle === "dark"
        ? "contrast(1.3) brightness(1.4)"
        : "none";
    }
  }, [mapStyle]);

  useEffect(() => {
    if (!mapRef.current || !ready) return;
    const { map, L } = mapRef.current;

    const COLORS = ["#c3f400", "#7df4ff", "#ffffff", "#d1bcff", "#00dbe9"];
    let colorIndex = 0;
    const activeUids = new Set<string>();

    Object.entries(locations).forEach(([uid, loc]) => {
      // Skip locations older than 10 minutes.
      if (Date.now() - loc.updatedAt > 10 * 60 * 1000) return;

      activeUids.add(uid);
      const isMe = uid === currentUid;
      const color = isMe ? "#c3f400" : COLORS[colorIndex++ % COLORS.length];
      const label = escapeHtml(isMe ? "YOU" : loc.name.split(" ")[0] || "Guest");
      const emoji = escapeHtml(loc.emoji);
      const hasHeading = (
        loc.heading !== null &&
        loc.heading !== undefined &&
        typeof loc.heading === "number" &&
        !Number.isNaN(loc.heading) &&
        Number.isFinite(loc.heading)
      );
      const arrowHtml = hasHeading ? `
        <div style="
          position: absolute;
          top: -14px;
          left: 50%;
          transform: translateX(-50%) rotate(${loc.heading}deg);
          transform-origin: 50% 100%;
          width: 0;
          height: 0;
          border-left: 5px solid transparent;
          border-right: 5px solid transparent;
          border-bottom: 12px solid ${color};
          filter: drop-shadow(0 0 3px ${color});
        "></div>
      ` : "";
      const pinHtml = `
        <div style="
          position: relative;
          display: inline-flex;
          flex-direction: column;
          align-items: center;
          pointer-events: none;
        ">
          ${arrowHtml}
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
            position: relative;
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
        </div>
      `;

      if (process.env.NODE_ENV === "development") {
        console.log("Heading for", loc.name, ":", loc.heading);
      }

      const icon = L.divIcon({
        className: "festival-friend-marker",
        html: pinHtml,
        iconAnchor: [18, 18],
      });

      if (markersRef.current[uid]) {
        markersRef.current[uid].setLatLng([loc.lat, loc.lng]);
        markersRef.current[uid].setIcon(icon);
      } else {
        markersRef.current[uid] = L.marker([loc.lat, loc.lng], { icon, pane: "festival-friends" }).addTo(map);
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

  useEffect(() => {
    if (!mapRef.current || !ready) return;
    const { map, L } = mapRef.current;

    if (meetingMarkerRef.current) {
      meetingMarkerRef.current.removeFrom(map);
      meetingMarkerRef.current = null;
    }

    if (!meetingPoint) return;

    const label = escapeHtml(meetingPoint.label);
    const icon = L.divIcon({
      className: "festival-meeting-marker",
      html: `<div class="festival-meeting-marker__inner">
  <div class="festival-meeting-marker__label">📍 ${label}</div>
  <div class="festival-meeting-marker__dot"></div>
</div>`,
      iconSize: [140, 42],
      iconAnchor: [70, 38],
    });

    meetingMarkerRef.current = L.marker([meetingPoint.lat, meetingPoint.lng], {
      icon,
      interactive: false,
      pane: "festival-meeting",
    }).addTo(map);
  }, [meetingPoint, ready]);

  return (
    <div
      ref={containerRef}
      className="festival-map"
    />
  );
}

export { getNearestStage };
