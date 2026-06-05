import { useEffect } from "react";
import { ref, set, onValue, off } from "firebase/database";
import { db, auth } from "@/lib/firebase";

export type FriendLocation = {
  lat: number;
  lng: number;
  name: string;
  emoji: string;
  updatedAt: number;
  battery?: number | null;
};

export function useLocation(
  enabled: boolean,
  sharing: boolean,
  emoji: string,
  intervalMs: number,
  name: string,
  onUpdate: (locations: Record<string, FriendLocation>) => void,
  onSelfUpdate?: (location: FriendLocation) => void
) {
  useEffect(() => {
    const locRef = ref(db, "locations");
    onValue(locRef, (snapshot) => {
      const data = snapshot.val();
      if (data) onUpdate(data);
    });

    return () => {
      off(locRef);
    };
  }, []);

  useEffect(() => {
    if (!enabled || !sharing || !("geolocation" in navigator)) return;

    let latestPosition: GeolocationPosition | null = null;
    let lastPublishedAt = 0;
    const publishLocation = async (pos: GeolocationPosition) => {
      const uid = auth.currentUser?.uid;
      if (!uid) return;

      lastPublishedAt = Date.now();
      let battery: number | null = null;
      if ("getBattery" in navigator) {
        try {
          const b = await (navigator as Navigator & { getBattery?: () => Promise<{ level: number }> }).getBattery?.();
          battery = typeof b?.level === "number" ? Math.round(b.level * 100) : null;
        } catch {}
      }

      const location = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        name,
        emoji,
        updatedAt: lastPublishedAt,
        battery,
      };

      onSelfUpdate?.(location);
      void set(ref(db, `locations/${uid}`), {
        ...location,
      });
    };

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        latestPosition = pos;
        if (lastPublishedAt === 0 || Date.now() - lastPublishedAt >= intervalMs) {
          void publishLocation(pos);
        }
      },
      (err) => console.error(err),
      {
        enableHighAccuracy: true,
        maximumAge: intervalMs,
        timeout: intervalMs + 5000,
      }
    );
    const intervalId = window.setInterval(() => {
      if (latestPosition && Date.now() - lastPublishedAt >= intervalMs) {
        void publishLocation(latestPosition);
      }
    }, intervalMs);

    return () => {
      navigator.geolocation.clearWatch(watchId);
      window.clearInterval(intervalId);
    };
  }, [enabled, sharing, emoji, intervalMs, name, onSelfUpdate]);
}
