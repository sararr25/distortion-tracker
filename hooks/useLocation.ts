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
  name: string,
  onUpdate: (locations: Record<string, FriendLocation>) => void
) {
  useEffect(() => {
    if (!enabled) {
      onUpdate({});
      return;
    }

    const locRef = ref(db, "locations");
    onValue(locRef, (snapshot) => {
      onUpdate(snapshot.val() ?? {});
    });

    return () => {
      off(locRef);
    };
  }, [enabled, onUpdate]);

  useEffect(() => {
    if (!enabled || !sharing || !("geolocation" in navigator)) return;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const uid = auth.currentUser?.uid;
        if (!uid) return;
        set(ref(db, `locations/${uid}`), {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          name,
          emoji,
          updatedAt: Date.now(),
        });
      },
      (err) => console.error(err),
      { enableHighAccuracy: true, maximumAge: 5000 }
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, [enabled, sharing, emoji, name]);
}
