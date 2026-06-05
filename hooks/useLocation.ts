import { useEffect } from "react";
import { ref, set, onValue, off } from "firebase/database";
import { db, auth } from "@/lib/firebase";

export type FriendLocation = {
  lat: number;
  lng: number;
  name: string;
  emoji: string;
  updatedAt: number;
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
    const publishLocation = (pos: GeolocationPosition) => {
      const uid = auth.currentUser?.uid;
      if (!uid) return;

      lastPublishedAt = Date.now();
      const location = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        name,
        emoji,
        updatedAt: lastPublishedAt,
      };

      onSelfUpdate?.(location);
      set(ref(db, `locations/${uid}`), {
        ...location,
      });
    };

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        latestPosition = pos;
        if (lastPublishedAt === 0 || Date.now() - lastPublishedAt >= intervalMs) {
          publishLocation(pos);
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
        publishLocation(latestPosition);
      }
    }, intervalMs);

    return () => {
      navigator.geolocation.clearWatch(watchId);
      window.clearInterval(intervalId);
    };
  }, [enabled, sharing, emoji, intervalMs, name, onSelfUpdate]);
}
