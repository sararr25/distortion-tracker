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
  active: boolean,
  emoji: string,
  intervalMs: number,
  displayName: string,
  onUpdate: (locations: Record<string, FriendLocation>) => void
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
  }, [onUpdate]);

  useEffect(() => {
    if (!active || !("geolocation" in navigator)) return;

    let intervalId: ReturnType<typeof setInterval> | null = null;

    const writePosition = () => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const uid = auth.currentUser?.uid;
          if (!uid) return;

          const writeBaseLocation = (battery?: number | null) => {
            void set(ref(db, `locations/${uid}`), {
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              name: displayName || auth.currentUser?.displayName || "Anonymous",
              emoji,
              updatedAt: Date.now(),
              ...(battery === undefined ? {} : { battery }),
            });
          };

          if ("getBattery" in navigator) {
            (navigator as Navigator & { getBattery?: () => Promise<{ level: number }> }).getBattery?.()
              .then((batteryManager) => {
                writeBaseLocation(Math.round(batteryManager.level * 100));
              })
              .catch(() => {
                writeBaseLocation();
              });
          } else {
            writeBaseLocation();
          }
        },
        (err) => console.warn("GPS error:", err),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    };

    writePosition();
    intervalId = setInterval(writePosition, intervalMs);

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [active, displayName, emoji, intervalMs]);
}
