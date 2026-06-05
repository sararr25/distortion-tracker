"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { signInWithRedirect, signOut } from "firebase/auth";
import {
  get,
  limitToLast,
  off,
  onChildAdded,
  onDisconnect,
  onValue,
  push,
  query as databaseQuery,
  ref,
  remove,
  runTransaction,
  serverTimestamp,
  set,
  update,
} from "firebase/database";
import { auth, db, provider } from "@/lib/firebase";
import { useAuth } from "@/hooks/useAuth";
import { FriendLocation, useLocation } from "@/hooks/useLocation";
import Lineup from "@/components/Lineup";
import { getNearestStage } from "@/components/Map";
import {
  hasSavedFcmToken,
  isPushSupported,
  listenForForegroundMessages,
  requestNotificationPermissionAndToken,
} from "@/lib/pushNotifications";

const Map = dynamic(() => import("@/components/Map"), {
  ssr: false,
  loading: () => <div className="map-loading">INITIALIZING RADAR</div>,
});

const EMOJIS = [
  "🔥", "⚡", "🎯", "👾", "💀", "🌀", "🐍", "🦊",
  "👸", "🦥", "🧔‍♂️", "🪩", "🧚", "🧙", "🤖", "👽",
  "🦄", "🌈", "🍒", "🧿", "🛸", "💎", "🫧", "🍄",
];
const ONBOARDING_STEPS = [
  {
    emoji: "📍",
    title: "SHARE YOUR POSITION",
    description: "Tap the pin button to let your friends see where you are",
  },
  {
    emoji: "⚡",
    title: "SEND A PULSE",
    description: "Tap the pulse button to vibrate everyone's phone and get their attention",
  },
  {
    emoji: "👥",
    title: "FIND YOUR CREW",
    description: "Your friends appear on the map and in the radar below",
  },
];
const FRESH_MS = 10 * 60 * 1000;

type FriendProfile = {
  name?: string;
  emoji?: string;
  online?: boolean;
  updatedAt?: number;
  lastSeen?: number;
};

type UserProfile = {
  displayName?: string;
  emoji?: string;
  updatedAt?: number;
};

type FriendSignal = {
  name: string;
  emoji: string;
  online: boolean;
  location?: FriendLocation;
  updatedAt: number;
  lastSeen: number;
};

type MeetingPoint = {
  lat: number;
  lng: number;
  label: string;
  setBy: string;
  setAt: number;
};

type MeetingPointEvent = MeetingPoint & {
  uid?: string;
  fromEmoji?: string;
};

const MEET_RESPONSE_LABELS = {
  coming: "I’m coming 🏃‍♀️",
  notComing: "Can’t, rave responsibly 🫡",
} as const;

type MeetResponseStatus = keyof typeof MEET_RESPONSE_LABELS;
type RsvpStatus = MeetResponseStatus | "pending";

type MeetResponse = {
  uid: string;
  name: string;
  emoji: string;
  status: MeetResponseStatus;
  label: string;
  updatedAt: number;
};

type MeetRequest = {
  id: string;
  type: "meet";
  fromUid: string;
  fromName: string;
  fromEmoji: string;
  lat: number;
  lng: number;
  message: string;
  createdAt: number;
  expiresAt: number;
  responses?: Record<string, MeetResponse | undefined>;
};

type MeetStatusPerson = {
  uid: string;
  name: string;
  emoji: string;
  status: RsvpStatus;
  label: string;
  updatedAt: number;
};

type MeetStatusGroups = {
  coming: MeetStatusPerson[];
  notComing: MeetStatusPerson[];
  pending: MeetStatusPerson[];
};

type PushStatus =
  | "loading"
  | "disabled"
  | "enabled"
  | "blocked"
  | "unsupported"
  | "ios-home-screen"
  | "saving"
  | "error";

type MeetToast = {
  message: string;
  variant: "success" | "warning" | "error";
};

type MeetAlert = MeetRequest & {
  source: "realtime" | "push";
};

// Firebase rules reminder: "meetingPoint": { ".read": "auth != null", ".write": "auth != null" }

type WakeLockSentinel = {
  release: () => Promise<void>;
};

type NavigatorWithWakeLock = Navigator & {
  wakeLock?: {
    request: (type: "screen") => Promise<WakeLockSentinel>;
  };
};

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

type GpsInterval = 3000 | 60000 | 300000;
type ActiveScreen = "map" | "lineup";
type SaveStatus = "idle" | "saving" | "saved";

function emojiKey(value: string) {
  return encodeURIComponent(value);
}

function getInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "DT";
}

function formatAge(updatedAt: number, now: number) {
  const seconds = Math.max(0, Math.floor((now - updatedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m`;
}

function getLastSeen(updatedAt: number, now: number): string {
  const diffMs = now - updatedAt;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  if (diffSec < 15) return "now";
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffMin < 60) return `${diffMin}min ago`;
  return "offline";
}

function getDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getSmartDistance(dist: number): string {
  if (dist < 50) return "👀 NEARBY";
  if (dist < 1000) return `${Math.round(dist)}m away`;
  return `${(dist / 1000).toFixed(1)}km away`;
}

function getDistanceColor(dist: number | null): string {
  if (dist === null) return "#666";
  if (dist < 50) return "#CCFF00";
  if (dist < 200) return "#FF6B00";
  return "#666";
}

function getFriendStatusColor(updatedAt: number, now: number): string {
  const age = now - updatedAt;
  if (age < 2 * 60 * 1000) return "#00FF88";
  if (age < 5 * 60 * 1000) return "#FFD700";
  return "#FF4444";
}

function isFreshLocation(location: FriendLocation | undefined, now: number): location is FriendLocation {
  return Boolean(location && now - location.updatedAt <= FRESH_MS);
}

function normalizeTimestamp(value: unknown) {
  return typeof value === "number" ? value : 0;
}

function getCurrentPositionAsync(options?: PositionOptions) {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}

function getErrorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return "";
  return String((error as { code?: unknown }).code ?? "");
}

function getErrorMessage(error: unknown) {
  if (!error || typeof error !== "object" || !("message" in error)) return "";
  return String((error as { message?: unknown }).message ?? "");
}

function isPermissionDeniedError(error: unknown) {
  const code = getErrorCode(error).toLowerCase();
  const message = getErrorMessage(error).toLowerCase();
  return code.includes("permission_denied") || code.includes("permission-denied") || message.includes("permission denied");
}

function isGeolocationPermissionDenied(error: unknown) {
  const code = getErrorCode(error);
  const message = getErrorMessage(error).toLowerCase();
  return code === "1" || message.includes("user denied geolocation") || message.includes("permission denied");
}

function makeMeetRequestId(uid: string) {
  return `${uid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isMeetResponseStatus(value: unknown): value is MeetResponseStatus {
  return value === "coming" || value === "notComing";
}

function getFirstName(name: string) {
  return name.trim().split(" ").filter(Boolean)[0] || "Someone";
}

function formatMeetRsvpTime(updatedAt: number, now: number) {
  if (!updatedAt) return "Still deciding";

  const diffMs = Math.max(0, now - updatedAt);
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin} min ago`;

  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  return "earlier";
}

function buildMeetStatusGroups(request: MeetRequest | null, friends: [string, FriendSignal][]): MeetStatusGroups {
  const groups: MeetStatusGroups = {
    coming: [],
    notComing: [],
    pending: [],
  };

  if (!request) return groups;

  const friendMap = new globalThis.Map(friends);
  const answeredUids = new Set<string>();
  const responses = request.responses ?? {};

  for (const [uid, response] of Object.entries(responses)) {
    if (uid === request.fromUid || !response || !isMeetResponseStatus(response.status)) continue;

    answeredUids.add(uid);
    const friend = friendMap.get(uid);
    const person: MeetStatusPerson = {
      uid,
      name: response.name?.trim() || friend?.name || "Anonymous",
      emoji: response.emoji || friend?.emoji || "🔥",
      status: response.status,
      label: response.label || MEET_RESPONSE_LABELS[response.status],
      updatedAt: normalizeTimestamp(response.updatedAt),
    };

    groups[response.status].push(person);
  }

  for (const [uid, friend] of friends) {
    if (uid === request.fromUid || answeredUids.has(uid)) continue;
    groups.pending.push({
      uid,
      name: friend.name,
      emoji: friend.emoji,
      status: "pending",
      label: "Still deciding",
      updatedAt: 0,
    });
  }

  groups.coming.sort((a, b) => b.updatedAt - a.updatedAt);
  groups.notComing.sort((a, b) => b.updatedAt - a.updatedAt);
  groups.pending.sort((a, b) => a.name.localeCompare(b.name));

  return groups;
}

export default function Home() {
  const { user, loading } = useAuth();
  const isFirstLoad = useRef(true);
  const pulseTimeoutRef = useRef<number | null>(null);
  const meetAlertTimeoutRef = useRef<number | null>(null);
  const meetToastTimeoutRef = useRef<number | null>(null);
  const meetCooldownTimeoutRef = useRef<number | null>(null);
  const meetResponseFeedbackTimeoutRef = useRef<number | null>(null);
  const huntTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const huntNoticeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sharingToastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sharingToastReadyRef = useRef(false);
  const activeFriendTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const installBannerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveStatusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const alertAudioRef = useRef<HTMLAudioElement | null>(null);
  const alertAudioLoadFailedRef = useRef(false);
  const audioUnlockedRef = useRef(false);
  const shownMeetRequestIdsRef = useRef<Set<string>>(new Set());
  const flyToRef = useRef<((lat: number, lng: number) => void) | null>(null);
  const [sharing, setSharing] = useState(false);
  const [locations, setLocations] = useState<Record<string, FriendLocation>>({});
  const [emoji, setEmoji] = useState("🔥");
  const [gpsInterval, setGpsInterval] = useState<GpsInterval>(60000);
  const [mapStyle, setMapStyle] = useState<"dark" | "light" | "satellite">("dark");
  const [profiles, setProfiles] = useState<Record<string, FriendProfile>>({});
  const [profileHydratedUid, setProfileHydratedUid] = useState<string | null>(null);
  const [emojiLocks, setEmojiLocks] = useState<Record<string, string>>({});
  const [profileName, setProfileName] = useState("");
  const [authError, setAuthError] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [tick, setTick] = useState(0);
  const [pulseAlert, setPulseAlert] = useState<{ from: string; emoji: string } | null>(null);
  const [gpsHuntNotice, setGpsHuntNotice] = useState(false);
  const [pulseChooserOpen, setPulseChooserOpen] = useState(false);
  const [pulseTargetUids, setPulseTargetUids] = useState<Set<string>>(() => new Set());
  const [focusedLocation, setFocusedLocation] = useState<{ lat: number; lng: number; focusId: number } | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [showSharingToast, setShowSharingToast] = useState(false);
  const [sharingToastMode, setSharingToastMode] = useState<"visible" | "hidden">("visible");
  const [activeFriend, setActiveFriend] = useState<string | null>(null);
  const [meetingPoint, setMeetingPoint] = useState<MeetingPoint | null>(null);
  const [meetModalOpen, setMeetModalOpen] = useState(false);
  const [meetLabel, setMeetLabel] = useState("");
  const [meetAlert, setMeetAlert] = useState<MeetAlert | null>(null);
  const [meetToast, setMeetToast] = useState<MeetToast | null>(null);
  const [meetCooldownUntil, setMeetCooldownUntil] = useState(0);
  const [meetSending, setMeetSending] = useState(false);
  const [meetResponseSending, setMeetResponseSending] = useState<MeetResponseStatus | null>(null);
  const [meetResponseFeedback, setMeetResponseFeedback] = useState("");
  const [meetStatusRequestId, setMeetStatusRequestId] = useState<string | null>(null);
  const [meetStatusRequest, setMeetStatusRequest] = useState<MeetRequest | null>(null);
  const [meetStatusOpen, setMeetStatusOpen] = useState(false);
  const [pushStatus, setPushStatus] = useState<PushStatus>("loading");
  const [pushBusy, setPushBusy] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const [installBannerMode, setInstallBannerMode] = useState<"android" | "ios" | null>(null);
  const [activeScreen, setActiveScreen] = useState<ActiveScreen>("map");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");

  const handleUpdate = useCallback((data: Record<string, FriendLocation>) => {
    setLocations(data);
  }, []);

  const clearAutoHuntTimeout = useCallback(() => {
    if (huntTimeoutRef.current) {
      clearTimeout(huntTimeoutRef.current);
      huntTimeoutRef.current = null;
    }
  }, []);

  const handleGpsIntervalChange = useCallback((interval: GpsInterval) => {
    setGpsInterval(interval);
    if (interval === 3000) clearAutoHuntTimeout();
  }, [clearAutoHuntTimeout]);

  const handleMapReady = useCallback((flyTo: (lat: number, lng: number) => void) => {
    flyToRef.current = flyTo;
  }, []);

  const isMeetCoolingDown = meetCooldownUntil > now;

  const showMeetToast = useCallback((message: string, variant: MeetToast["variant"]) => {
    setMeetToast({ message, variant });
    if (meetToastTimeoutRef.current) {
      window.clearTimeout(meetToastTimeoutRef.current);
    }
    meetToastTimeoutRef.current = window.setTimeout(() => {
      setMeetToast(null);
      meetToastTimeoutRef.current = null;
    }, 3200);
  }, []);

  const lockMeetActions = useCallback((durationMs = 8000) => {
    setMeetCooldownUntil(Date.now() + durationMs);
    if (meetCooldownTimeoutRef.current) {
      window.clearTimeout(meetCooldownTimeoutRef.current);
    }
    meetCooldownTimeoutRef.current = window.setTimeout(() => {
      setMeetCooldownUntil(0);
      meetCooldownTimeoutRef.current = null;
    }, durationMs);
  }, []);

  const dismissMeetAlert = useCallback(() => {
    setMeetAlert(null);
    setMeetResponseFeedback("");
    setMeetResponseSending(null);
    if (meetAlertTimeoutRef.current) {
      window.clearTimeout(meetAlertTimeoutRef.current);
      meetAlertTimeoutRef.current = null;
    }
    if (meetResponseFeedbackTimeoutRef.current) {
      window.clearTimeout(meetResponseFeedbackTimeoutRef.current);
      meetResponseFeedbackTimeoutRef.current = null;
    }
  }, []);

  const focusMeetRequest = useCallback((request: MeetRequest) => {
    const lat = Number(request.lat);
    const lng = Number(request.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      flyToRef.current?.(lat, lng);
      setFocusedLocation({ lat, lng, focusId: Date.now() });
    }
  }, []);

  const playAlertSound = useCallback(() => {
    if (!audioUnlockedRef.current) return;

    if (!alertAudioRef.current) {
      const audio = new Audio("/assets/alert-sound.wav");
      audio.preload = "auto";
      audio.addEventListener("error", () => {
        alertAudioLoadFailedRef.current = true;
      });
      alertAudioRef.current = audio;
      void audio.load();
    }

    const audio = alertAudioRef.current;
    if (!audio) return;

    if (!alertAudioLoadFailedRef.current) {
      try {
        audio.currentTime = 0;
        const playPromise = audio.play();
        if (playPromise) {
          void playPromise.catch(() => {
            // Browser autoplay policies can block audio; ignore silently.
          });
        }
        return;
      } catch {
        // Fallback only when asset playback fails.
      }
    }

    if (alertAudioLoadFailedRef.current) {
      try {
        const AudioContextConstructor =
          window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioContextConstructor) return;

        const ctx = audioContextRef.current ?? new AudioContextConstructor();
        audioContextRef.current = ctx;
        void ctx.resume().then(() => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.type = "triangle";
          osc.frequency.setValueAtTime(220, ctx.currentTime);
          osc.frequency.exponentialRampToValueAtTime(120, ctx.currentTime + 0.18);
          gain.gain.setValueAtTime(0.45, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.24);
          osc.start(ctx.currentTime);
          osc.stop(ctx.currentTime + 0.26);
        });
      } catch {
        // Intentional no-op: sound feedback is optional.
      }
    }
  }, []);

  const triggerMeetRequestAlert = useCallback((request: MeetRequest, source: "realtime" | "push") => {
    if (shownMeetRequestIdsRef.current.has(request.id)) return;
    shownMeetRequestIdsRef.current.add(request.id);

    if (navigator.vibrate) {
      navigator.vibrate([200, 100, 200, 100, 400]);
    }

    playAlertSound();

    document.title = `📍 MEET: ${request.fromName.toUpperCase()}`;
    if (titleTimeoutRef.current) clearTimeout(titleTimeoutRef.current);
    titleTimeoutRef.current = setTimeout(() => {
      document.title = "Distortion Tracker";
      titleTimeoutRef.current = null;
    }, 10000);

    setMeetResponseFeedback("");
    setMeetResponseSending(null);
    setMeetAlert({ ...request, source });
    if (meetAlertTimeoutRef.current) {
      window.clearTimeout(meetAlertTimeoutRef.current);
      meetAlertTimeoutRef.current = null;
    }
  }, [playAlertSound]);

  const registerPushToken = useCallback(async () => {
    if (!user) return;

    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const standalone =
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true ||
      window.matchMedia("(display-mode: standalone)").matches;

    if (ios && !standalone) {
      setPushStatus("ios-home-screen");
      return;
    }

    setPushBusy(true);
    try {
      const result = await requestNotificationPermissionAndToken(user);
      if (result.status === "enabled") {
        setPushStatus("enabled");
        showMeetToast("Push notifications enabled", "success");
        return;
      }
      if (result.status === "blocked") {
        setPushStatus("blocked");
        showMeetToast("Notifications blocked", "warning");
        return;
      }
      if (result.status === "unsupported") {
        setPushStatus("unsupported");
        showMeetToast("Push not supported in this browser", "warning");
        return;
      }
      setPushStatus("disabled");
    } catch (error) {
      console.error("Failed to enable push notifications:", error);
      setPushStatus("error");
      showMeetToast("Push setup failed", "error");
    } finally {
      setPushBusy(false);
    }
  }, [showMeetToast, user]);

  const displayName = profileName.trim() || user?.displayName || "Anonymous";
  const isIOS = typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isInStandaloneMode =
    typeof window !== "undefined" &&
    (((window.navigator as Navigator & { standalone?: boolean }).standalone === true) ||
      window.matchMedia("(display-mode: standalone)").matches);

  const openMeetRequestForCurrentUser = useCallback((request: MeetRequest, source: "realtime" | "push") => {
    if (!user) return;
    if (!request.id || request.type !== "meet") return;
    if (request.expiresAt && request.expiresAt < Date.now()) {
      showMeetToast("Meet request expired", "warning");
      return;
    }

    shownMeetRequestIdsRef.current.add(request.id);

    if (request.fromUid === user.uid) {
      setMeetStatusRequestId(request.id);
      setMeetStatusRequest(request);
      setMeetStatusOpen(true);
      return;
    }

    setMeetResponseFeedback("");
    setMeetResponseSending(null);
    setMeetAlert({ ...request, source });
    if (meetAlertTimeoutRef.current) {
      window.clearTimeout(meetAlertTimeoutRef.current);
      meetAlertTimeoutRef.current = null;
    }
  }, [showMeetToast, user]);

  const handleMeetResponse = useCallback(async (request: MeetRequest, status: MeetResponseStatus) => {
    if (!user || meetResponseSending) return;

    const previousStatus = request.responses?.[user.uid]?.status;
    const label = MEET_RESPONSE_LABELS[status];
    const response = {
      uid: user.uid,
      name: displayName,
      emoji,
      status,
      label,
      updatedAt: serverTimestamp(),
    };

    setMeetResponseSending(status);
    setMeetResponseFeedback("");

    try {
      await set(ref(db, `meetingRequests/${request.id}/responses/${user.uid}`), response);

      const localResponse: MeetResponse = {
        uid: user.uid,
        name: displayName,
        emoji,
        status,
        label,
        updatedAt: Date.now(),
      };

      setMeetAlert((current) => {
        if (!current || current.id !== request.id) return current;
        return {
          ...current,
          responses: {
            ...(current.responses ?? {}),
            [user.uid]: localResponse,
          },
        };
      });

      setMeetResponseFeedback(isMeetResponseStatus(previousStatus) ? "Response updated" : "Response sent");
      if (meetResponseFeedbackTimeoutRef.current) {
        window.clearTimeout(meetResponseFeedbackTimeoutRef.current);
        meetResponseFeedbackTimeoutRef.current = null;
      }
      if (meetAlertTimeoutRef.current) {
        window.clearTimeout(meetAlertTimeoutRef.current);
        meetAlertTimeoutRef.current = null;
      }
    } catch (error) {
      console.error("Failed to send Meet RSVP:", error);
      showMeetToast(isPermissionDeniedError(error) ? "Firebase permissions blocked RSVP" : "Response failed", "error");
    } finally {
      setMeetResponseSending(null);
    }
  }, [displayName, emoji, meetResponseSending, showMeetToast, user]);

  const openMeetRequestById = useCallback(async (requestId: string) => {
    if (!requestId) return;

    try {
      const snapshot = await get(ref(db, `meetingRequests/${requestId}`));
      const request = snapshot.exists() ? snapshot.val() as MeetRequest : null;
      if (!request || request.type !== "meet" || (request.expiresAt && request.expiresAt < Date.now())) {
        showMeetToast("Meet request expired", "warning");
        return;
      }

      openMeetRequestForCurrentUser(request, "push");
    } catch (error) {
      console.error("Failed to open Meet request:", error);
      showMeetToast("Meet request unavailable", "warning");
    }
  }, [openMeetRequestForCurrentUser, showMeetToast]);

  useLocation(Boolean(user && sharing), emoji, gpsInterval, displayName, handleUpdate);

  useEffect(() => {
    if (!user || profileHydratedUid !== user.uid) return;

    const url = new URL(window.location.href);
    const requestId = url.searchParams.get("meetRequestId");
    if (!requestId) return;

    let cancelled = false;
    const cleanMeetRequestUrl = () => {
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.delete("meetRequestId");
      const nextPath = `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
      window.history.replaceState(window.history.state, "", nextPath || "/");
    };

    const loadMeetRequest = async () => {
      await openMeetRequestById(requestId);
      if (!cancelled) cleanMeetRequestUrl();
    };

    void loadMeetRequest();

    return () => {
      cancelled = true;
    };
  }, [openMeetRequestById, profileHydratedUid, user]);

  useEffect(() => {
    if (!user || profileHydratedUid !== user.uid) return;

    const handleServiceWorkerMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; requestId?: unknown } | null;
      if (!data || data.type !== "open-meet-request" || typeof data.requestId !== "string") return;
      void openMeetRequestById(data.requestId);
    };

    navigator.serviceWorker?.addEventListener("message", handleServiceWorkerMessage);

    return () => {
      navigator.serviceWorker?.removeEventListener("message", handleServiceWorkerMessage);
    };
  }, [openMeetRequestById, profileHydratedUid, user]);

  useEffect(() => {
    if (!user) return;

    const profilesRef = ref(db, "profiles");
    const unsubscribe = onValue(profilesRef, (snapshot) => {
      setProfiles((snapshot.val() ?? {}) as Record<string, FriendProfile>);
    });

    return () => {
      unsubscribe();
    };
  }, [user]);

  useEffect(() => {
    if (!user || profileHydratedUid === user.uid) return;

    let cancelled = false;
    let fallbackTimeout: ReturnType<typeof setTimeout> | null = null;

    const hydrateProfile = (profile: UserProfile | null) => {
      if (cancelled) return;

      const presenceProfile = profiles[user.uid];
      const savedName =
        profile?.displayName?.trim() ||
        presenceProfile?.name?.trim() ||
        window.localStorage.getItem(`dt-profile-name-${user.uid}`) ||
        user.displayName ||
        "Anonymous";
      const savedEmoji =
        profile?.emoji ||
        presenceProfile?.emoji ||
        window.localStorage.getItem(`dt-profile-emoji-${user.uid}`) ||
        "🔥";

      setProfileName(savedName.slice(0, 20));
      setEmoji(savedEmoji);
      setProfileHydratedUid(user.uid);
    };

    const loadProfile = async () => {
      const userProfileSnapshot = await get(ref(db, `userProfiles/${user.uid}`)).catch((error) => {
        console.error("Failed to load user profile:", error);
        return null;
      });
      const userProfile = userProfileSnapshot?.exists() ? userProfileSnapshot.val() as UserProfile : null;

      if (cancelled) return;
      if (fallbackTimeout) clearTimeout(fallbackTimeout);
      hydrateProfile(userProfile);
    };

    fallbackTimeout = setTimeout(() => hydrateProfile(null), 1500);
    void loadProfile();

    return () => {
      cancelled = true;
      if (fallbackTimeout) clearTimeout(fallbackTimeout);
    };
  }, [profileHydratedUid, profiles, user]);

  useEffect(() => {
    if (!user) return;

    const locksRef = ref(db, "emojiLocks");
    onValue(locksRef, (snapshot) => {
      setEmojiLocks((snapshot.val() ?? {}) as Record<string, string>);
    });

    return () => {
      off(locksRef);
    };
  }, [user]);

  useEffect(() => {
    if (!user) return;

    const meetingRef = ref(db, "meetingPoint");
    const unsubscribe = onValue(meetingRef, (snapshot) => {
      setMeetingPoint((snapshot.val() ?? null) as MeetingPoint | null);
    });

    return () => {
      unsubscribe();
    };
  }, [user]);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    const initializePush = async () => {
      try {
        const supported = await isPushSupported();
        if (cancelled) return;

        if (!supported) {
          setPushStatus("unsupported");
          return;
        }

        if (isIOS && !isInStandaloneMode) {
          setPushStatus("ios-home-screen");
          return;
        }

        if (Notification.permission === "denied") {
          setPushStatus("blocked");
          return;
        }

        if (Notification.permission === "granted") {
          const hasToken = await hasSavedFcmToken(user);
          if (cancelled) return;
          if (!hasToken) {
            const tokenResult = await requestNotificationPermissionAndToken(user);
            if (cancelled) return;
            setPushStatus(tokenResult.status === "enabled" ? "enabled" : "disabled");
            return;
          }
        }

        const hasToken = await hasSavedFcmToken(user);
        if (cancelled) return;

        setPushStatus(hasToken ? "enabled" : "disabled");
      } catch (error) {
        console.warn("Push support check failed:", error);
        if (!cancelled) setPushStatus("error");
      }
    };

    void initializePush();

    return () => {
      cancelled = true;
    };
  }, [isIOS, isInStandaloneMode, user]);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;
    let unsubscribeForeground: (() => void) | undefined;

    const initializeForegroundListener = async () => {
      try {
        const supported = await isPushSupported();
        if (!supported) return;

        unsubscribeForeground = await listenForForegroundMessages((payload) => {
          const data = payload.data;
          if (!data || data.type !== "meet" || !data.requestId || !data.fromUid || !data.fromName || !data.fromEmoji) {
            return;
          }

          if (data.fromUid === user.uid) return;

          triggerMeetRequestAlert({
            id: data.requestId,
            type: "meet",
            fromUid: data.fromUid,
            fromName: data.fromName,
            fromEmoji: data.fromEmoji,
            lat: Number(data.lat),
            lng: Number(data.lng),
            message: data.message || `${data.fromName} wants to meet`,
            createdAt: Date.now(),
            expiresAt: Date.now() + 10 * 60 * 1000,
          }, "push");
        });
      } catch (error) {
        if (!cancelled) {
          console.warn("Foreground push listener failed:", error);
        }
      }
    };

    void initializeForegroundListener();

    return () => {
      cancelled = true;
      unsubscribeForeground?.();
    };
  }, [triggerMeetRequestAlert, user]);

  useEffect(() => {
    if (!user) return;

    const listeningSince = Date.now();
    const meetRequestsRef = databaseQuery(ref(db, "meetingRequests"), limitToLast(50));
    const unsub = onChildAdded(meetRequestsRef, (snapshot) => {
      const request = snapshot.val() as MeetRequest | null;
      if (!request || request.type !== "meet") return;
      if (!request.id || shownMeetRequestIdsRef.current.has(request.id)) return;
      if (request.fromUid === user.uid) return;
      if (request.createdAt && request.createdAt < listeningSince - 5000) return;
      if (request.expiresAt && request.expiresAt < Date.now()) return;
      triggerMeetRequestAlert(request, "realtime");
    });

    return () => {
      unsub();
    };
  }, [triggerMeetRequestAlert, user]);

  useEffect(() => {
    if (!user || !meetStatusRequestId) return;

    const requestRef = ref(db, `meetingRequests/${meetStatusRequestId}`);
    const unsubscribe = onValue(requestRef, (snapshot) => {
      const request = snapshot.val() as MeetRequest | null;
      if (!request || request.type !== "meet") {
        setMeetStatusRequest(null);
        setMeetStatusOpen(false);
        return;
      }

      setMeetStatusRequest(request);
    });

    return () => {
      unsubscribe();
    };
  }, [meetStatusRequestId, user]);

  useEffect(() => {
    const isDismissed = window.localStorage.getItem("pwa_banner_dismissed") === "true";
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent ?? "");
    const isInStandaloneMode =
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true ||
      window.matchMedia("(display-mode: standalone)").matches;

    if (isDismissed || isInStandaloneMode) return;

    const scheduleBanner = (mode: "android" | "ios") => {
      if (installBannerTimeoutRef.current) clearTimeout(installBannerTimeoutRef.current);
      installBannerTimeoutRef.current = setTimeout(() => {
        setInstallBannerMode(mode);
        setShowInstallBanner(true);
      }, 30000);
    };

    const handler = (event: Event) => {
      const promptEvent = event as BeforeInstallPromptEvent;
      promptEvent.preventDefault();
      setInstallPrompt(promptEvent);
      scheduleBanner("android");
    };

    window.addEventListener("beforeinstallprompt", handler);
    if (isIOS) scheduleBanner("ios");

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      if (installBannerTimeoutRef.current) {
        clearTimeout(installBannerTimeoutRef.current);
        installBannerTimeoutRef.current = null;
      }
    };
  }, []);

  const isEmojiLocked = useCallback((item: string) => {
    const owner = emojiLocks[emojiKey(item)];
    return Boolean(user && owner && owner !== user.uid && profiles[owner]?.online === true);
  }, [emojiLocks, profiles, user]);

  const handleEmojiChange = useCallback(async (nextEmoji: string) => {
    if (!user || isEmojiLocked(nextEmoji)) return;

    const previousEmoji = emoji;
    const nextKey = emojiKey(nextEmoji);
    const result = await runTransaction(ref(db, `emojiLocks/${nextKey}`), (currentOwner) => {
      if (currentOwner === null || currentOwner === user.uid) return user.uid;
      if (typeof currentOwner === "string" && profiles[currentOwner]?.online !== true) return user.uid;
      return;
    });

    if (!result.committed && result.snapshot.val() !== user.uid) return;

    setEmoji(nextEmoji);
    await update(ref(db, `profiles/${user.uid}`), {
      name: displayName,
      emoji: nextEmoji,
      updatedAt: serverTimestamp(),
    }).catch((error) => {
      if (!isPermissionDeniedError(error)) {
        console.error("Failed to update profile emoji:", error);
      }
    });

    const previousKey = emojiKey(previousEmoji);
    if (previousKey === nextKey) return;

    const previousRef = ref(db, `emojiLocks/${previousKey}`);
    const previousLock = await get(previousRef);
    if (previousLock.val() === user.uid) {
      await remove(previousRef);
    }
  }, [displayName, emoji, isEmojiLocked, profiles, user]);

  const handleSharingToggle = useCallback(() => {
    setSharing((value) => {
      return !value;
    });
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => setTick((value) => value + 1), 15000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!user) return;

    const timeout = window.setTimeout(() => {
      if (window.localStorage.getItem("distortion_onboarded") !== "true") {
        setOnboardingStep(0);
        setShowOnboarding(true);
      }
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [user]);

  useEffect(() => {
    if (!user) return;

    if (!sharingToastReadyRef.current) {
      sharingToastReadyRef.current = true;
      return;
    }

    setSharingToastMode(sharing ? "visible" : "hidden");
    setShowSharingToast(true);

    if (sharingToastTimeoutRef.current) clearTimeout(sharingToastTimeoutRef.current);
    sharingToastTimeoutRef.current = setTimeout(() => {
      setShowSharingToast(false);
      sharingToastTimeoutRef.current = null;
    }, 3000);
  }, [sharing, user]);

  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    const enable = async () => {
      try {
        if ("wakeLock" in navigator) {
          lock = await (navigator as NavigatorWithWakeLock).wakeLock?.request("screen") ?? null;
        }
      } catch (e) {
        console.warn("Wake lock failed:", e);
      }
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void enable();
    };
    void enable();
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      void lock?.release();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js").catch((error) => {
        console.warn("Service worker registration failed:", error);
      });
      void navigator.serviceWorker.register("/firebase-messaging-sw.js").catch((error) => {
        console.warn("Messaging service worker registration failed:", error);
      });
    }
  }, []);

  useEffect(() => {
    const unlockAudio = () => {
      try {
        audioUnlockedRef.current = true;
        if (!alertAudioRef.current) {
          const audio = new Audio("/assets/alert-sound.wav");
          audio.preload = "auto";
          audio.addEventListener("error", () => {
            alertAudioLoadFailedRef.current = true;
          });
          alertAudioRef.current = audio;
          void audio.load();
        }
      } catch (error) {
        console.warn("Audio unlock failed:", error);
      }
    };

    window.addEventListener("pointerdown", unlockAudio, { once: true });
    window.addEventListener("touchstart", unlockAudio, { once: true });
    window.addEventListener("keydown", unlockAudio, { once: true });

    return () => {
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("touchstart", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (pulseTimeoutRef.current) {
        window.clearTimeout(pulseTimeoutRef.current);
      }
      if (huntTimeoutRef.current) {
        clearTimeout(huntTimeoutRef.current);
      }
      if (huntNoticeTimeoutRef.current) {
        clearTimeout(huntNoticeTimeoutRef.current);
      }
      if (titleTimeoutRef.current) {
        clearTimeout(titleTimeoutRef.current);
      }
      if (sharingToastTimeoutRef.current) {
        clearTimeout(sharingToastTimeoutRef.current);
      }
      if (activeFriendTimeoutRef.current) {
        clearTimeout(activeFriendTimeoutRef.current);
      }
      if (installBannerTimeoutRef.current) {
        clearTimeout(installBannerTimeoutRef.current);
      }
      if (saveStatusTimeoutRef.current) {
        clearTimeout(saveStatusTimeoutRef.current);
      }
      if (meetAlertTimeoutRef.current) {
        clearTimeout(meetAlertTimeoutRef.current);
      }
      if (meetToastTimeoutRef.current) {
        clearTimeout(meetToastTimeoutRef.current);
      }
      if (meetCooldownTimeoutRef.current) {
        clearTimeout(meetCooldownTimeoutRef.current);
      }
      if (meetResponseFeedbackTimeoutRef.current) {
        clearTimeout(meetResponseFeedbackTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!user || profileHydratedUid !== user.uid || !profileName.trim()) return;
    window.localStorage.setItem(`dt-profile-name-${user.uid}`, profileName.trim());
  }, [profileHydratedUid, profileName, user]);

  useEffect(() => {
    if (!user || profileHydratedUid !== user.uid) return;
    window.localStorage.setItem(`dt-profile-emoji-${user.uid}`, emoji);
  }, [emoji, profileHydratedUid, user]);

  useEffect(() => {
    if (!user || profileHydratedUid !== user.uid) return;
    let timeout: number | undefined;

    const owner = emojiLocks[emojiKey(emoji)];
    if (!owner || owner === user.uid || profiles[owner]?.online !== true) {
      timeout = window.setTimeout(() => void handleEmojiChange(emoji), 0);
      return () => {
        if (timeout) window.clearTimeout(timeout);
      };
    }

    const fallbackEmoji = EMOJIS.find((item) => {
      const fallbackOwner = emojiLocks[emojiKey(item)];
      return !fallbackOwner || fallbackOwner === user.uid || profiles[fallbackOwner]?.online !== true;
    });

    if (fallbackEmoji) {
      timeout = window.setTimeout(() => void handleEmojiChange(fallbackEmoji), 0);
    }

    return () => {
      if (timeout) window.clearTimeout(timeout);
    };
  }, [emoji, emojiLocks, handleEmojiChange, profileHydratedUid, profiles, user]);

  useEffect(() => {
    if (!user || profileHydratedUid !== user.uid) return;
    void update(ref(db, `profiles/${user.uid}`), {
      name: displayName,
      emoji,
      updatedAt: serverTimestamp(),
    }).catch((error) => {
      if (!isPermissionDeniedError(error)) {
        console.error("Failed to sync profile:", error);
      }
    });
  }, [displayName, emoji, profileHydratedUid, user]);

  useEffect(() => {
    if (!user || profileHydratedUid !== user.uid) return;

    const connectedRef = ref(db, ".info/connected");
    const profileRef = ref(db, `profiles/${user.uid}`);
    const unsubscribe = onValue(connectedRef, (snapshot) => {
      if (snapshot.val() !== true) return;

      void onDisconnect(profileRef)
        .update({
          online: false,
          lastSeen: serverTimestamp(),
        })
        .then(() =>
          update(profileRef, {
            online: true,
            lastSeen: serverTimestamp(),
          })
        )
        .catch((error) => {
          if (!isPermissionDeniedError(error)) {
            console.error(error);
          }
        });
    });

    return () => {
      unsubscribe();
      void update(profileRef, {
        online: false,
        lastSeen: serverTimestamp(),
      }).catch((error) => {
        if (!isPermissionDeniedError(error)) {
          console.error("Failed to set offline profile state:", error);
        }
      });
    };
  }, [profileHydratedUid, user]);

  const requestWakeLock = useCallback(async () => {
    try {
      if ("wakeLock" in navigator) {
        const lock = await (navigator as NavigatorWithWakeLock).wakeLock?.request("screen");
        setTimeout(() => {
          void lock?.release();
        }, 30000);
      }
    } catch (e) {
      console.warn("Wake lock failed:", e);
    }
  }, []);

  const activateTemporaryHuntMode = useCallback(() => {
    setGpsInterval(3000);

    if (huntTimeoutRef.current) clearTimeout(huntTimeoutRef.current);
    huntTimeoutRef.current = setTimeout(() => {
      setGpsInterval(60000);
      huntTimeoutRef.current = null;
    }, 2 * 60 * 1000);

    setGpsHuntNotice(true);
    if (huntNoticeTimeoutRef.current) clearTimeout(huntNoticeTimeoutRef.current);
    huntNoticeTimeoutRef.current = setTimeout(() => {
      setGpsHuntNotice(false);
      huntNoticeTimeoutRef.current = null;
    }, 2000);
  }, []);

  const showAlertNotification = useCallback((title: string, body: string, tag: string) => {
    if (!("Notification" in window) || Notification.permission !== "granted") return;

    const options = {
      body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag,
      renotify: true,
      requireInteraction: true,
      vibrate: [500, 100, 500, 100, 800],
      data: { url: "/" },
    } as NotificationOptions & {
      badge?: string;
      renotify?: boolean;
      requireInteraction?: boolean;
      vibrate?: number[];
      data?: { url: string };
    };

    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.ready
        .then((registration) => registration.showNotification(title, options))
        .catch(() => {
          new Notification(title, options);
        });
      return;
    }

    new Notification(title, options);
  }, []);

  const triggerPulse = useCallback((name: string, pulseEmoji: string, autoHunt = true) => {
    if (navigator.vibrate) {
      navigator.vibrate([500, 100, 500, 100, 500, 100, 800]);
    }

    void requestWakeLock();

    playAlertSound();

    document.title = `⚡ PULSE FROM ${name.toUpperCase()}`;
    if (titleTimeoutRef.current) clearTimeout(titleTimeoutRef.current);
    titleTimeoutRef.current = setTimeout(() => {
      document.title = "Distortion Tracker";
      titleTimeoutRef.current = null;
    }, 10000);

    showAlertNotification(`⚡ ${name} sent a pulse!`, "Open the app to see their location", "pulse");

    setPulseAlert({ from: name, emoji: pulseEmoji });
    if (pulseTimeoutRef.current) {
      window.clearTimeout(pulseTimeoutRef.current);
    }
    pulseTimeoutRef.current = window.setTimeout(() => setPulseAlert(null), 2500);

    if (autoHunt) activateTemporaryHuntMode();
  }, [activateTemporaryHuntMode, playAlertSound, requestWakeLock, showAlertNotification]);

  const triggerMeetingPointAlert = useCallback((meeting: MeetingPointEvent) => {
    if (navigator.vibrate) {
      navigator.vibrate([700, 120, 700, 120, 1000]);
    }

    void requestWakeLock();
    playAlertSound();

    document.title = `📍 MEET: ${meeting.label.toUpperCase()}`;
    if (titleTimeoutRef.current) clearTimeout(titleTimeoutRef.current);
    titleTimeoutRef.current = setTimeout(() => {
      document.title = "Distortion Tracker";
      titleTimeoutRef.current = null;
    }, 10000);

    showAlertNotification(
      `📍 Meeting point set by ${meeting.setBy}`,
      `${meeting.label} · open the app to see it on the map`,
      "meeting-point"
    );
  }, [playAlertSound, requestWakeLock, showAlertNotification]);

  useEffect(() => {
    if (!user) return;

    isFirstLoad.current = true;
    const timeout = window.setTimeout(() => {
      isFirstLoad.current = false;
    }, 2000);
    const pulsesRef = ref(db, "pulses");
    const unsub = onChildAdded(pulsesRef, (snapshot) => {
      if (isFirstLoad.current) return;
      const pulse = snapshot.val() as { from?: string; fromEmoji?: string; uid?: string; recipients?: string[] } | null;
      if (!pulse || pulse.uid === auth.currentUser?.uid) return;
      if (Array.isArray(pulse.recipients) && user && !pulse.recipients.includes(user.uid)) return;
      triggerPulse(pulse.from ?? "Someone", pulse.fromEmoji ?? "⚡");
    });

    return () => {
      unsub();
      window.clearTimeout(timeout);
      isFirstLoad.current = true;
    };
  }, [triggerPulse, user]);

  useEffect(() => {
    if (!user) return;

    const listeningSince = Date.now();
    const eventsRef = databaseQuery(ref(db, "meetingPointEvents"), limitToLast(25));
    const unsub = onChildAdded(eventsRef, (snapshot) => {
      const event = snapshot.val() as MeetingPointEvent | null;
      if (!event || event.setAt < listeningSince - 5000) return;
      triggerMeetingPointAlert(event);
    });

    return () => {
      unsub();
    };
  }, [triggerMeetingPointAlert, user]);

  const effectiveLocations = locations;

  const liveEntries = useMemo(
    () =>
      Object.entries(effectiveLocations)
        .filter(([, loc]) => isFreshLocation(loc, now))
        .sort(([, a], [, b]) => b.updatedAt - a.updatedAt),
    [effectiveLocations, now]
  );

  const friends = useMemo(() => {
    const liveLocationUids = liveEntries.map(([uid]) => uid);
    const knownUids = new Set([...Object.keys(profiles), ...liveLocationUids]);

    return Array.from(knownUids)
      .filter((uid) => uid !== user?.uid)
      .map((uid): [string, FriendSignal] | null => {
        const profile = profiles[uid];
        const location = effectiveLocations[uid];
        const freshLocation = isFreshLocation(location, now) ? location : undefined;
        const online = profile?.online === true || Boolean(freshLocation);

        if (!online) return null;

        const name = profile?.name?.trim() || freshLocation?.name || "Anonymous";
        const emoji = profile?.emoji || freshLocation?.emoji || "🔥";

        return [
          uid,
          {
            name,
            emoji,
            online,
            location: freshLocation,
            updatedAt: freshLocation?.updatedAt ?? normalizeTimestamp(profile?.updatedAt),
            lastSeen: normalizeTimestamp(profile?.lastSeen),
          },
        ];
      })
      .filter((entry): entry is [string, FriendSignal] => Boolean(entry))
      .sort(([, a], [, b]) => {
        const aTime = a.location?.updatedAt ?? a.lastSeen ?? a.updatedAt;
        const bTime = b.location?.updatedAt ?? b.lastSeen ?? b.updatedAt;
        return bTime - aTime;
      });
  }, [effectiveLocations, liveEntries, now, profiles, user?.uid]);

  const meetStatusGroups = useMemo(
    () => buildMeetStatusGroups(meetStatusRequest, friends),
    [friends, meetStatusRequest]
  );

  const currentLocation = user ? effectiveLocations[user.uid] : undefined;
  const currentStage = sharing && currentLocation ? getNearestStage(currentLocation.lat, currentLocation.lng) : "";
  const onlineCount = friends.length + 1;

  const handleOpenPulseChooser = useCallback(() => {
    setPulseTargetUids(new Set(friends.map(([uid]) => uid)));
    setPulseChooserOpen(true);
  }, [friends]);

  const handlePulseTargetToggle = useCallback((uid: string) => {
    setPulseTargetUids((current) => {
      const next = new Set(current);
      if (next.has(uid)) {
        next.delete(uid);
      } else {
        next.add(uid);
      }
      return next;
    });
  }, []);

  const handleClosePulseChooser = useCallback(() => {
    setPulseChooserOpen(false);
  }, []);

  const sendPulse = useCallback(async (recipients?: string[]) => {
    if (recipients && recipients.length === 0) return;

    triggerPulse(displayName, emoji, false);
    setPulseChooserOpen(false);
    await push(ref(db, "pulses"), {
      from: displayName,
      fromEmoji: emoji,
      uid: auth.currentUser?.uid,
      recipients: recipients ?? null,
      at: serverTimestamp(),
    });
  }, [displayName, emoji, triggerPulse]);

  const handleSendPulseToAll = useCallback(() => {
    void sendPulse();
  }, [sendPulse]);

  const handleSendPulseToSelected = useCallback(() => {
    void sendPulse(Array.from(pulseTargetUids));
  }, [pulseTargetUids, sendPulse]);

  const handleFocusFriend = useCallback((friend: FriendLocation) => {
    flyToRef.current?.(friend.lat, friend.lng);
    setFocusedLocation({
      lat: friend.lat,
      lng: friend.lng,
      focusId: Date.now(),
    });
    setPanelOpen(false);
    setMenuOpen(false);
  }, []);

  const handleRadarFriendFocus = useCallback((uid: string, friend: FriendLocation) => {
    flyToRef.current?.(friend.lat, friend.lng);
    setFocusedLocation({
      lat: friend.lat,
      lng: friend.lng,
      focusId: Date.now(),
    });
    setActiveFriend(uid);

    if (activeFriendTimeoutRef.current) clearTimeout(activeFriendTimeoutRef.current);
    activeFriendTimeoutRef.current = setTimeout(() => {
      setActiveFriend(null);
      activeFriendTimeoutRef.current = null;
    }, 1500);
  }, []);

  const handleCenterOnMe = useCallback(() => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        flyToRef.current?.(pos.coords.latitude, pos.coords.longitude);
      },
      (err) => console.error(err)
    );
  }, []);

  const handleOpenMeetModal = useCallback(() => {
    if (isMeetCoolingDown) {
      showMeetToast("Meet request sent", "warning");
      return;
    }
    setMeetModalOpen(true);
  }, [isMeetCoolingDown, showMeetToast]);

  const handleSetMeetingPoint = useCallback(async () => {
    if (!user || isMeetCoolingDown || meetSending) return;

    const label = meetLabel.trim() || "MEET HERE";
    const requestId = makeMeetRequestId(user.uid);

    try {
      setMeetSending(true);
      let lat: number;
      let lng: number;

      try {
        const precisePosition = await getCurrentPositionAsync({ enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
        lat = precisePosition.coords.latitude;
        lng = precisePosition.coords.longitude;
      } catch (geoError) {
        const fallbackLocation = user ? locations[user.uid] : undefined;
        if (fallbackLocation && isFreshLocation(fallbackLocation, Date.now())) {
          lat = fallbackLocation.lat;
          lng = fallbackLocation.lng;
          showMeetToast("GPS denied, using last known position", "warning");
        } else {
          throw geoError;
        }
      }

      const message = `${displayName} wants to meet`;
      const createdAt = Date.now();
      const expiresAt = createdAt + 10 * 60 * 1000;

      const request: MeetRequest = {
        id: requestId,
        type: "meet",
        fromUid: user.uid,
        fromName: displayName,
        fromEmoji: emoji,
        lat,
        lng,
        message,
        createdAt,
        expiresAt,
        responses: {},
      };

      const meetingPointEvent: MeetingPointEvent = {
        lat,
        lng,
        label,
        setBy: displayName,
        fromEmoji: emoji,
        uid: user.uid,
        setAt: createdAt,
      };

      let requestSavedToDatabase = true;
      try {
        await set(ref(db, "meetingPoint"), meetingPointEvent);
        await push(ref(db, "meetingPointEvents"), {
          ...meetingPointEvent,
          at: serverTimestamp(),
        });
        await set(ref(db, `meetingRequests/${requestId}`), {
          ...request,
          createdAtServer: serverTimestamp(),
        });
        setMeetStatusRequestId(requestId);
        setMeetStatusRequest(request);
        setMeetStatusOpen(true);
      } catch (dbError) {
        requestSavedToDatabase = false;
        if (!isPermissionDeniedError(dbError)) {
          throw dbError;
        }
        console.warn("Meet database write blocked by rules:", dbError);
      }

      setMeetModalOpen(false);
      setMeetLabel("");
      lockMeetActions(8000);
      showMeetToast(requestSavedToDatabase ? "Meet request sent" : "Meet sent with limited mode", requestSavedToDatabase ? "success" : "warning");

      let pushSent = false;
      try {
        const response = await fetch("/api/send-meet-push", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            requestId,
            fromUid: user.uid,
            fromName: displayName,
            fromEmoji: emoji,
            lat,
            lng,
            message,
          }),
        });

        const result = (await response.json().catch(() => null)) as { success?: boolean } | null;
        pushSent = response.ok && result?.success === true;
        if (!pushSent) {
          showMeetToast("Meet sent, but push notification failed", "warning");
        }
      } catch (error) {
        console.warn("Meet push send failed:", error);
        showMeetToast("Meet sent, but push notification failed", "warning");
      }

      if (!requestSavedToDatabase && !pushSent) {
        throw new Error("Meet request failed: database blocked and push failed");
      }
    } catch (error) {
      console.error("Failed to send Meet request:", error);
      if (isGeolocationPermissionDenied(error)) {
        showMeetToast("Location permission denied for Meet", "error");
      } else if (isPermissionDeniedError(error)) {
        showMeetToast("Firebase permissions blocked Meet", "error");
      } else {
        showMeetToast("Meet request failed", "error");
      }
    } finally {
      setMeetSending(false);
    }
  }, [displayName, emoji, isMeetCoolingDown, lockMeetActions, locations, meetLabel, meetSending, showMeetToast, user]);

  const handleFocusMeetingPoint = useCallback(() => {
    if (!meetingPoint) return;
    flyToRef.current?.(meetingPoint.lat, meetingPoint.lng);
  }, [meetingPoint]);

  const handleDismissInstallBanner = useCallback(() => {
    window.localStorage.setItem("pwa_banner_dismissed", "true");
    setShowInstallBanner(false);
  }, []);

  const handleInstall = useCallback(async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === "accepted") setShowInstallBanner(false);
  }, [installPrompt]);

  const handleCloseOnboarding = useCallback(() => {
    window.localStorage.setItem("distortion_onboarded", "true");
    setShowOnboarding(false);
  }, []);

  const handleAdvanceOnboarding = useCallback(() => {
    if (onboardingStep >= ONBOARDING_STEPS.length - 1) {
      handleCloseOnboarding();
      return;
    }

    setOnboardingStep((step) => step + 1);
  }, [handleCloseOnboarding, onboardingStep]);

  async function handleLogin() {
    setAuthError("");
    try {
      await signInWithRedirect(auth, provider);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Login failed.");
    }
  }

  async function handleLogout() {
    setMenuOpen(false);
    setPanelOpen(false);
    setSharing(false);
    setMeetAlert(null);
    setMeetStatusOpen(false);
    setMeetStatusRequest(null);
    setMeetStatusRequestId(null);
    if (user) {
      await update(ref(db, `profiles/${user.uid}`), {
        online: false,
        lastSeen: serverTimestamp(),
      }).catch((error) => {
        if (!isPermissionDeniedError(error)) {
          console.error(error);
        }
      });
    }
    await signOut(auth);
  }

  const handleSaveProfile = useCallback(async () => {
    if (!user) return;

    const savedName = displayName.slice(0, 20);
    setSaveStatus("saving");

    try {
      await set(ref(db, `userProfiles/${user.uid}`), {
        emoji,
        displayName: savedName,
        updatedAt: Date.now(),
      });
      await update(ref(db, `profiles/${user.uid}`), {
        name: savedName,
        emoji,
        updatedAt: serverTimestamp(),
      }).catch((error) => {
        if (!isPermissionDeniedError(error)) {
          throw error;
        }
      });

      setProfileName(savedName);
      window.localStorage.setItem(`dt-profile-name-${user.uid}`, savedName);
      window.localStorage.setItem(`dt-profile-emoji-${user.uid}`, emoji);
      setSaveStatus("saved");

      if (saveStatusTimeoutRef.current) clearTimeout(saveStatusTimeoutRef.current);
      saveStatusTimeoutRef.current = setTimeout(() => {
        setSaveStatus("idle");
        saveStatusTimeoutRef.current = null;
      }, 2000);
    } catch (error) {
      console.error("Failed to save profile:", error);
      setSaveStatus("idle");
    }
  }, [displayName, emoji, user]);

  if (loading) {
    return (
      <main className="loading-screen">
        <div className="strobe" />
        <p>SYNCING GRID</p>
      </main>
    );
  }

  if (!user) {
    return <LoginScreen authError={authError} onLogin={handleLogin} />;
  }

  if (profileHydratedUid !== user.uid) {
    return (
      <main className="loading-screen">
        <div className="strobe" />
        <p>LOADING PROFILE</p>
      </main>
    );
  }

  return (
    <main className="app-shell">
      {pulseAlert && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            background: "rgba(204, 255, 0, 0.15)",
            backdropFilter: "blur(4px)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "1rem",
            animation: "pulseIn 0.3s ease-out",
          }}
        >
          <div style={{ fontSize: "4rem" }}>{pulseAlert.emoji}</div>
          <div
            style={{
              color: "#CCFF00",
              fontFamily: "monospace",
              fontWeight: 900,
              fontSize: "1.4rem",
              letterSpacing: "0.15em",
            }}
          >
            {pulseAlert.from.split(" ")[0].toUpperCase()}
          </div>
          <div
            style={{
              color: "#fff",
              fontFamily: "monospace",
              fontSize: "0.85rem",
              opacity: 0.7,
            }}
          >
            SENT A PULSE
          </div>
          {gpsHuntNotice && (
            <div
              style={{
                color: "#FF6B00",
                fontFamily: "monospace",
                fontSize: "0.8rem",
                fontWeight: 900,
                letterSpacing: "0.12em",
              }}
            >
              📡 GPS → HUNT MODE
            </div>
          )}
        </div>
      )}

      {meetAlert && (
        <MeetRequestOverlay
          request={meetAlert}
          currentUid={user.uid}
          responseFeedback={meetResponseFeedback}
          submittingStatus={meetResponseSending}
          onClose={dismissMeetAlert}
          onFocusMeetingPoint={() => {
            focusMeetRequest(meetAlert);
            dismissMeetAlert();
          }}
          onRespond={(status) => void handleMeetResponse(meetAlert, status)}
        />
      )}

      {meetStatusRequest && !meetStatusOpen && (
        <button className="meet-status-fab" type="button" onClick={() => setMeetStatusOpen(true)}>
          MEET STATUS
        </button>
      )}

      {meetStatusRequest && meetStatusOpen && (
        <MeetStatusPanel
          groups={meetStatusGroups}
          now={now}
          request={meetStatusRequest}
          onClose={() => setMeetStatusOpen(false)}
          onFocusMeetingPoint={() => focusMeetRequest(meetStatusRequest)}
        />
      )}

      {meetToast && (
        <div className={meetToast.variant === "success" ? "meet-toast success" : meetToast.variant === "warning" ? "meet-toast warning" : "meet-toast error"}>
          {meetToast.message}
        </div>
      )}

      {showOnboarding && (
        <OnboardingOverlay
          step={onboardingStep}
          onNext={handleAdvanceOnboarding}
          onClose={handleCloseOnboarding}
        />
      )}

      {meetModalOpen && (
        <MeetHereModal
          label={meetLabel}
          onLabelChange={setMeetLabel}
          onCancel={() => setMeetModalOpen(false)}
          onSetPoint={handleSetMeetingPoint}
          isSubmitting={meetSending}
          isCoolingDown={isMeetCoolingDown}
        />
      )}

      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <div className="noise-layer" />

      <header className="top-bar">
        <button
          className="icon-button mobile-only"
          type="button"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          onClick={() => {
            setMenuOpen((value) => !value);
            setPanelOpen(false);
          }}
        >
          ☰
        </button>
        <button
          className="meet-top-button"
          type="button"
          disabled={isMeetCoolingDown}
          onClick={handleOpenMeetModal}
        >
          📍 MEET
        </button>
        <div className="brand-lockup">
          <span>DISTORTION</span>
          <strong>TRACKER</strong>
        </div>
        <nav className="desktop-nav" aria-label="Sections">
          <button
            className={activeScreen === "map" ? "nav-item active" : "nav-item"}
            type="button"
            onClick={() => setActiveScreen("map")}
          >
            <span>⌖</span> Live Map
          </button>
          <button
            className={activeScreen === "lineup" ? "nav-item active" : "nav-item"}
            type="button"
            onClick={() => setActiveScreen("lineup")}
          >
            <span>🎵</span> Lineup
          </button>
          <button
            className="nav-item"
            type="button"
            onClick={() => setActiveScreen("map")}
          >
            <span>◎</span> Friend Radar
          </button>
          <button
            className="nav-item"
            type="button"
            onClick={() => setActiveScreen("map")}
          >
            <span>▣</span> Profile
          </button>
        </nav>
        <button
          className="share-pill"
          type="button"
          aria-pressed={sharing}
          onClick={handleSharingToggle}
        >
          <span className={sharing ? "status-dot on" : "status-dot"} />
          {sharing ? "LIVE" : "GO LIVE"}
        </button>
      </header>

      {showSharingToast && (
        <div className={sharingToastMode === "visible" ? "sharing-toast visible" : "sharing-toast hidden"}>
          {sharingToastMode === "visible" ? "📡 YOUR POSITION IS NOW VISIBLE TO YOUR CREW" : "📍 POSITION HIDDEN"}
        </div>
      )}

      {showInstallBanner && installBannerMode && (
        <PwaInstallBanner
          isIOS={installBannerMode === "ios" && !installPrompt}
          onDismiss={handleDismissInstallBanner}
          onInstall={handleInstall}
        />
      )}

      {activeScreen === "lineup" ? (
        <div className="workspace lineup-workspace">
          <Lineup />
        </div>
      ) : (
        <div className="workspace">
          <section className="map-stage" id="map" aria-label="Live map">
            <div className="map-frame">
              <Map
                locations={effectiveLocations}
                currentUid={user.uid}
                mapStyle={mapStyle}
                meetingPoint={meetingPoint}
                onMapReady={handleMapReady}
                focusedLocation={focusedLocation}
              />
              <div className="map-style-switcher" aria-label="Map style">
                {(["dark", "light", "satellite"] as const).map((style) => (
                  <button
                    key={style}
                    className={mapStyle === style ? "active" : ""}
                    onClick={() => setMapStyle(style)}
                    type="button"
                    aria-label={`Use ${style} map style`}
                    aria-pressed={mapStyle === style}
                  >
                    {style === "dark" ? "🌑" : style === "light" ? "🌕" : "🛰️"}
                  </button>
                ))}
              </div>
              <div className="scanline-layer" />
              <div className="radar-sweep" />
            </div>

            <div className="map-floating">
              <div className="map-tools" aria-label="Map status">
                <span>{onlineCount} ONLINE</span>
                <span>{sharing ? "GPS ACTIVE" : "GPS MUTED"}</span>
              </div>
              <button
                className="meet-map-button"
                type="button"
                disabled={isMeetCoolingDown}
                onClick={handleOpenMeetModal}
              >
                📍 MEET
              </button>
            </div>

            <div className="zone-card">
              <p>[ZONE_STATUS]</p>
              <div>
                <span>REFSHALEOEN</span>
                <strong>TRACKING</strong>
              </div>
              <div>
                <span>FRIENDS</span>
                <strong>{friends.length} ONLINE</strong>
              </div>
            </div>

            {currentStage && <div className="you-stage-badge">YOU: {currentStage}</div>}

            <button
              className="center-me-button"
              type="button"
              aria-label="Center map on me"
              onClick={handleCenterOnMe}
            >
              🎯
            </button>

            <button
              className="pulse-button"
              type="button"
              onClick={handleOpenPulseChooser}
            >
              <span>SEND</span>
              <strong>PULSE</strong>
            </button>

            <MobileRadar
              friends={friends}
              currentLocation={currentLocation}
              open={panelOpen}
              tick={tick}
              now={now}
              activeFriend={activeFriend}
              meetingPoint={meetingPoint}
              onFocusFriend={handleRadarFriendFocus}
              onFocusMeetingPoint={handleFocusMeetingPoint}
              onToggleOpen={() => setPanelOpen((value) => !value)}
            />
          </section>

          <CommandCenter
            currentLocation={currentLocation}
            friends={friends}
            emoji={emoji}
            gpsInterval={gpsInterval}
            emojis={EMOJIS}
            now={now}
            profileName={profileName}
            userName={displayName}
            userEmail={user.email ?? "No email"}
            saveStatus={saveStatus}
            installAvailable={Boolean(installPrompt)}
            isIOS={isIOS}
            isInStandaloneMode={isInStandaloneMode}
            pushStatus={pushStatus}
            pushBusy={pushBusy}
            onLogout={handleLogout}
            onGpsIntervalChange={handleGpsIntervalChange}
            onNameChange={(name) => setProfileName(name.slice(0, 20))}
            onEmojiChange={handleEmojiChange}
            onSaveProfile={handleSaveProfile}
            onInstall={handleInstall}
            onEnablePush={registerPushToken}
            onFocusFriend={handleFocusFriend}
            onSendPulse={handleOpenPulseChooser}
            isEmojiLocked={isEmojiLocked}
          />
        </div>
      )}

      <MobileMenu
        open={menuOpen}
        emoji={emoji}
        gpsInterval={gpsInterval}
        emojis={EMOJIS}
        displayName={displayName}
        profileName={profileName}
        userEmail={user.email ?? "No email"}
        saveStatus={saveStatus}
        installAvailable={Boolean(installPrompt)}
        isIOS={isIOS}
        isInStandaloneMode={isInStandaloneMode}
        pushStatus={pushStatus}
        pushBusy={pushBusy}
        onClose={() => setMenuOpen(false)}
        onEmojiChange={handleEmojiChange}
        onGpsIntervalChange={handleGpsIntervalChange}
        onLogout={handleLogout}
        onNameChange={(name) => setProfileName(name.slice(0, 20))}
        onSaveProfile={handleSaveProfile}
        onInstall={handleInstall}
        onEnablePush={registerPushToken}
        isEmojiLocked={isEmojiLocked}
      />

      <PulseChooser
        friends={friends}
        open={pulseChooserOpen}
        selectedUids={pulseTargetUids}
        onClose={handleClosePulseChooser}
        onSendAll={handleSendPulseToAll}
        onSendSelected={handleSendPulseToSelected}
        onToggleTarget={handlePulseTargetToggle}
      />

      <nav className="bottom-nav" aria-label="Mobile navigation">
        <button
          className={panelOpen ? "active" : ""}
          type="button"
          aria-label={panelOpen ? "Close friend radar" : "Open friend radar"}
          onClick={() => {
            setActiveScreen("map");
            setPanelOpen((value) => !value);
            setMenuOpen(false);
          }}
        >
          <span>◎</span>
          <small>Radar</small>
        </button>
        <button
          className={activeScreen === "lineup" ? "active" : ""}
          type="button"
          aria-label="Open lineup"
          onClick={() => {
            setActiveScreen("lineup");
            setPanelOpen(false);
            setMenuOpen(false);
          }}
        >
          <span>🎵</span>
          <small>Lineup</small>
        </button>
        <button type="button" aria-label="Send pulse" onClick={handleOpenPulseChooser}>
          <span>⌁</span>
          <small>Pulse</small>
        </button>
        <button
          className={sharing ? "active" : ""}
          type="button"
          aria-label={sharing ? "Stop sharing" : "Start sharing"}
          onClick={handleSharingToggle}
        >
          <span>{sharing ? "◉" : "○"}</span>
          <small>{sharing ? "Live" : "Go live"}</small>
        </button>
      </nav>
    </main>
  );
}

function LoginScreen({
  authError,
  onLogin,
}: {
  authError: string;
  onLogin: () => void;
}) {
  return (
    <main className="login-screen">
      <div className="login-grid" />
      <div className="noise-layer" />
      <section className="login-content" aria-label="Distortion Tracker access">
        <div className="system-label">
          <span />
          <p>SYSTEM INITIALIZE</p>
          <span />
        </div>
        <h1>
          THE GRID
          <span aria-hidden="true">THE GRID</span>
        </h1>
        <button className="enter-button" type="button" onClick={onLogin}>
          <span>ENTER WITH GOOGLE</span>
          <strong>G</strong>
        </button>
        <div className="login-meta">
          <p>AUTHENTICATE VIA GOOGLE LINK</p>
          <small>v 2.0.4</small>
        </div>
        {authError && <p className="auth-error">{authError}</p>}
      </section>
    </main>
  );
}

function OnboardingOverlay({
  step,
  onNext,
  onClose,
}: {
  step: number;
  onNext: () => void;
  onClose: () => void;
}) {
  const item = ONBOARDING_STEPS[step];
  const isLastStep = step === ONBOARDING_STEPS.length - 1;

  return (
    <div className="onboarding-overlay" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      <button className="onboarding-close" type="button" aria-label="Close onboarding" onClick={onClose}>
        ×
      </button>
      <section className="onboarding-card">
        <div className="onboarding-emoji">{item.emoji}</div>
        <h2 id="onboarding-title">{item.title}</h2>
        <p>{item.description}</p>
        <button className="onboarding-next" type="button" onClick={onNext}>
          {isLastStep ? "LET'S GO ⚡" : "NEXT →"}
        </button>
        <div className="onboarding-dots" aria-label={`Step ${step + 1} of ${ONBOARDING_STEPS.length}`}>
          {ONBOARDING_STEPS.map((_, index) => (
            <span key={index} className={index === step ? "active" : ""} />
          ))}
        </div>
      </section>
    </div>
  );
}

function MeetHereModal({
  label,
  onLabelChange,
  onCancel,
  onSetPoint,
  isSubmitting,
  isCoolingDown,
}: {
  label: string;
  onLabelChange: (value: string) => void;
  onCancel: () => void;
  onSetPoint: () => void;
  isSubmitting: boolean;
  isCoolingDown: boolean;
}) {
  return (
    <div className="meet-modal-backdrop" role="presentation">
      <section className="meet-modal" role="dialog" aria-modal="true" aria-labelledby="meet-modal-title">
        <h2 id="meet-modal-title">SEND MEET REQUEST</h2>
        <input
          value={label}
          onChange={(event) => onLabelChange(event.target.value)}
          placeholder="e.g. RAVE STAGE ENTRANCE"
          maxLength={30}
          type="text"
        />
        <p>Saves the point and notifies your crew with a push alert when possible</p>
        <div className="meet-modal-actions">
          <button className="cancel" type="button" onClick={onCancel}>
            CANCEL
          </button>
          <button className="set" type="button" disabled={isSubmitting || isCoolingDown} onClick={onSetPoint}>
            {isSubmitting ? "SENDING..." : isCoolingDown ? "WAIT" : "SET POINT ⚡"}
          </button>
        </div>
      </section>
    </div>
  );
}

function MeetRequestOverlay({
  request,
  currentUid,
  responseFeedback,
  submittingStatus,
  onClose,
  onFocusMeetingPoint,
  onRespond,
}: {
  request: MeetAlert;
  currentUid: string;
  responseFeedback: string;
  submittingStatus: MeetResponseStatus | null;
  onClose: () => void;
  onFocusMeetingPoint: () => void;
  onRespond: (status: MeetResponseStatus) => void;
}) {
  const hasCoordinates = Number.isFinite(request.lat) && Number.isFinite(request.lng);
  const currentResponse = request.responses?.[currentUid];
  const currentStatus = isMeetResponseStatus(currentResponse?.status) ? currentResponse.status : null;
  const currentLabel = currentStatus ? currentResponse?.label || MEET_RESPONSE_LABELS[currentStatus] : "";
  const senderFirstName = getFirstName(request.fromName);
  const confirmationTitle = currentStatus === "coming"
    ? `Go find ${senderFirstName}`
    : `${senderFirstName} got your RSVP`;

  return (
    <div className="meet-alert-backdrop" role="dialog" aria-modal="true" aria-labelledby="meet-alert-title">
      <section className="meet-alert-card">
        <button className="meet-alert-close" type="button" aria-label="Close meet alert" onClick={onClose}>
          ×
        </button>
        <div className="meet-alert-emoji">{request.fromEmoji}</div>
        <p className="meet-alert-kicker">MEET REQUEST</p>
        <h2 id="meet-alert-title">{request.fromName} wants to meet</h2>
        <p className="meet-alert-message">{request.message}</p>
        {responseFeedback && currentStatus && (
          <div className="meet-alert-confirmed">
            <span>{responseFeedback}</span>
            <h3>{confirmationTitle}</h3>
            <p>Jump to the meeting point on the map.</p>
            {hasCoordinates && (
              <button className="meet-alert-view-position" type="button" onClick={onFocusMeetingPoint}>
                View position
              </button>
            )}
          </div>
        )}
        {currentLabel && (
          <p className="meet-alert-current">
            Current response <strong>{currentLabel}</strong>
          </p>
        )}
        <div className="meet-alert-rsvp-actions">
          <button
            className="meet-alert-rsvp coming"
            type="button"
            aria-pressed={currentStatus === "coming"}
            disabled={submittingStatus !== null}
            onClick={() => onRespond("coming")}
          >
            {MEET_RESPONSE_LABELS.coming}
          </button>
          <button
            className="meet-alert-rsvp not-coming"
            type="button"
            aria-pressed={currentStatus === "notComing"}
            disabled={submittingStatus !== null}
            onClick={() => onRespond("notComing")}
          >
            {MEET_RESPONSE_LABELS.notComing}
          </button>
        </div>
        {hasCoordinates && !responseFeedback && (
          <button className="meet-alert-focus" type="button" onClick={onFocusMeetingPoint}>
            Show meeting point
          </button>
        )}
      </section>
    </div>
  );
}

function MeetStatusPanel({
  request,
  groups,
  now,
  onClose,
  onFocusMeetingPoint,
}: {
  request: MeetRequest;
  groups: MeetStatusGroups;
  now: number;
  onClose: () => void;
  onFocusMeetingPoint: () => void;
}) {
  return (
    <section className="meet-status-panel" role="dialog" aria-modal="false" aria-labelledby="meet-status-title">
      <div className="meet-status-header">
        <div>
          <p>LIVE RSVP</p>
          <h2 id="meet-status-title">MEET STATUS</h2>
        </div>
        <button type="button" aria-label="Close meet status" onClick={onClose}>
          ×
        </button>
      </div>
      <button className="meet-status-point" type="button" onClick={onFocusMeetingPoint}>
        📍 {request.message}
      </button>
      <MeetStatusSection title="COMING" people={groups.coming} now={now} />
      <MeetStatusSection title="CAN’T MAKE IT" people={groups.notComing} now={now} />
      <MeetStatusSection title="PENDING" people={groups.pending} now={now} />
    </section>
  );
}

function MeetStatusSection({
  title,
  people,
  now,
}: {
  title: string;
  people: MeetStatusPerson[];
  now: number;
}) {
  return (
    <div className="meet-status-section">
      <h3>{title}</h3>
      {people.length === 0 ? (
        <p className="meet-status-empty">No one yet</p>
      ) : (
        <div className="meet-status-list">
          {people.map((person) => (
            <div className="meet-status-row" key={person.uid}>
              <span>{person.emoji}</span>
              <strong>{getFirstName(person.name)}</strong>
              <small>{person.label}</small>
              <time>{formatMeetRsvpTime(person.updatedAt, now)}</time>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PwaInstallBanner({
  isIOS,
  onDismiss,
  onInstall,
}: {
  isIOS: boolean;
  onDismiss: () => void;
  onInstall: () => void;
}) {
  return (
    <div style={{
      position: "fixed", bottom: "5rem", left: "1rem", right: "1rem",
      background: "#0a0a0a", border: "1px solid #CCFF00", borderRadius: "8px",
      padding: "0.75rem 1rem", zIndex: 2000,
      display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem"
    }}>
      <div>
        <div style={{ color: "#CCFF00", fontFamily: "monospace", fontWeight: 900, fontSize: "0.8rem" }}>
          ⚡ ADD TO HOME SCREEN
        </div>
        <div style={{ color: "#666", fontFamily: "monospace", fontSize: "0.65rem", marginTop: "2px" }}>
          {isIOS ? "Tap Share → Add to Home Screen" : "Works better as an app"}
        </div>
      </div>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button onClick={onDismiss} type="button" style={{
          minHeight: "44px", minWidth: "44px",
          background: "none", border: "1px solid #333", color: "#666",
          fontFamily: "monospace", fontSize: "0.7rem", padding: "0.4rem 0.6rem",
          borderRadius: "4px", cursor: "pointer"
        }}>✕</button>
        {!isIOS && (
          <button onClick={onInstall} type="button" style={{
            minHeight: "44px",
            background: "#CCFF00", border: "none", color: "#000",
            fontFamily: "monospace", fontWeight: 900, fontSize: "0.7rem",
            padding: "0.4rem 0.8rem", borderRadius: "4px", cursor: "pointer"
          }}>INSTALL</button>
        )}
      </div>
    </div>
  );
}

function GpsModeControl({
  gpsInterval,
  onGpsIntervalChange,
}: {
  gpsInterval: GpsInterval;
  onGpsIntervalChange: (interval: GpsInterval) => void;
}) {
  const modes: Array<{
    interval: GpsInterval;
    color: string;
    label: string;
    sublabel: string;
  }> = [
    { interval: 3000, color: "#FF6B00", label: "🔍 HUNT", sublabel: "3s · find friends" },
    { interval: 60000, color: "#CCFF00", label: "🔋 CHILL", sublabel: "1min · balanced" },
    { interval: 300000, color: "#00FFFF", label: "💤 SAVE", sublabel: "5min · battery" },
  ];

  return (
    <div>
      <p style={{ color: "#666", fontFamily: "monospace", fontSize: "0.75rem", marginBottom: "0.75rem", letterSpacing: "0.1em" }}>GPS MODE</p>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        {modes.map((mode) => (
          <button
            key={mode.interval}
            type="button"
            aria-pressed={gpsInterval === mode.interval}
            onClick={() => onGpsIntervalChange(mode.interval)}
            style={{
              flex: 1, minHeight: "48px", padding: "0.85rem 0.45rem", fontFamily: "monospace", fontWeight: 900,
              fontSize: "0.78rem", letterSpacing: "0.08em", cursor: "pointer",
              borderRadius: "6px", border: "none",
              background: gpsInterval === mode.interval ? "#1a1a1a" : "transparent",
              color: gpsInterval === mode.interval ? mode.color : "#444",
              outline: gpsInterval === mode.interval ? `1px solid ${mode.color}` : "1px solid #333",
            }}
          >
            {mode.label}<br />
            <span style={{ fontSize: "0.62rem", fontWeight: 400, opacity: 0.7 }}>{mode.sublabel}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function InstallAppSection({
  installAvailable,
  isIOS,
  isInStandaloneMode,
  onInstall,
}: {
  installAvailable: boolean;
  isIOS: boolean;
  isInStandaloneMode: boolean;
  onInstall: () => void | Promise<void>;
}) {
  return (
    <div className="install-section">
      <p className="panel-label">INSTALL APP</p>
      {installAvailable ? (
        <button className="install-app-button" type="button" onClick={() => void onInstall()}>
          ⚡ ADD TO HOME SCREEN
        </button>
      ) : isIOS && !isInStandaloneMode ? (
        <div className="install-note">
          <p>
            Tap <strong>Share ↑</strong> in Safari then <strong>&quot;Add to Home Screen&quot;</strong> to install the app
          </p>
        </div>
      ) : isInStandaloneMode ? (
        <p className="install-installed">✓ APP ALREADY INSTALLED</p>
      ) : (
        <p className="install-unavailable">Open in Chrome or Safari to install</p>
      )}
    </div>
  );
}

function PushNotificationsSection({
  status,
  isBusy,
  isIOS,
  isInStandaloneMode,
  onEnablePush,
}: {
  status: PushStatus;
  isBusy: boolean;
  isIOS: boolean;
  isInStandaloneMode: boolean;
  onEnablePush: () => void | Promise<void>;
}) {
  const statusCopy =
    status === "enabled"
      ? "Push notifications enabled"
      : status === "blocked"
        ? "Notifications blocked"
        : status === "ios-home-screen"
          ? "Install the app to Home Screen to receive notifications on iPhone"
          : status === "unsupported"
            ? "Push notifications disabled"
            : "Push notifications disabled";

  const buttonDisabled = isBusy || status === "unsupported" || (status === "ios-home-screen" && (!isIOS || isInStandaloneMode));

  return (
    <div className="push-section">
      <p className="panel-label">PUSH ALERTS</p>
      <div className={status === "enabled" ? "push-status enabled" : status === "blocked" ? "push-status blocked" : "push-status"}>
        {statusCopy}
      </div>
      <button className="push-enable-button" type="button" disabled={buttonDisabled} onClick={() => void onEnablePush()}>
        {isBusy ? "ENABLING..." : "ENABLE PUSH NOTIFICATIONS"}
      </button>
    </div>
  );
}

function CommandCenter({
  currentLocation,
  friends,
  emoji,
  gpsInterval,
  emojis,
  now,
  profileName,
  userName,
  userEmail,
  saveStatus,
  installAvailable,
  isIOS,
  isInStandaloneMode,
  pushStatus,
  pushBusy,
  onLogout,
  onGpsIntervalChange,
  onNameChange,
  onEmojiChange,
  onSaveProfile,
  onInstall,
  onEnablePush,
  onFocusFriend,
  onSendPulse,
  isEmojiLocked,
}: {
  currentLocation?: FriendLocation;
  friends: [string, FriendSignal][];
  emoji: string;
  gpsInterval: GpsInterval;
  emojis: string[];
  now: number;
  profileName: string;
  userName: string;
  userEmail: string;
  saveStatus: SaveStatus;
  installAvailable: boolean;
  isIOS: boolean;
  isInStandaloneMode: boolean;
  pushStatus: PushStatus;
  pushBusy: boolean;
  onLogout: () => void;
  onGpsIntervalChange: (interval: GpsInterval) => void;
  onNameChange: (name: string) => void;
  onEmojiChange: (emoji: string) => void | Promise<void>;
  onSaveProfile: () => void | Promise<void>;
  onInstall: () => void | Promise<void>;
  onEnablePush: () => void | Promise<void>;
  onFocusFriend: (friend: FriendLocation) => void;
  onSendPulse: () => void;
  isEmojiLocked: (emoji: string) => boolean;
}) {
  return (
    <aside className="command-center" id="radar">
      <div className="command-action">
        <button className="command-pulse" type="button" onClick={onSendPulse}>
          <span>⌁</span>
          SEND PULSE
        </button>
      </div>

      <section className="panel-block" id="profile">
        <p className="panel-label">[PROFILE]</p>
        <div className="profile-row">
          <div className="avatar">{getInitials(userName)}</div>
          <div>
            <strong>{userName}</strong>
            <span>{userEmail}</span>
          </div>
        </div>
        <label className="profile-field">
          <span>DISPLAY NAME</span>
          <input
            value={profileName}
            onChange={(event) => onNameChange(event.target.value.slice(0, 20))}
            maxLength={20}
            placeholder="Your name"
            type="text"
          />
        </label>
        <div className="telemetry">
          <span>MARKER</span>
          <strong>{emoji}</strong>
        </div>
        <div className="telemetry">
          <span>LAST GPS</span>
          <strong>{currentLocation ? `${formatAge(currentLocation.updatedAt, now)} AGO` : "WAITING"}</strong>
        </div>
      </section>

      <section className="panel-block">
        <GpsModeControl gpsInterval={gpsInterval} onGpsIntervalChange={onGpsIntervalChange} />
      </section>

      <section className="panel-block">
        <p className="panel-label">[EMOJI_SELECT]</p>
        <div className="marker-grid">
          {emojis.map((item) => (
            <button
              key={item}
              className={item === emoji ? "selected" : ""}
              type="button"
              aria-pressed={item === emoji}
              disabled={isEmojiLocked(item)}
              title={isEmojiLocked(item) ? "Already chosen" : undefined}
              onClick={() => void onEmojiChange(item)}
            >
              {item}
            </button>
          ))}
        </div>
        <button
          className={saveStatus === "saved" ? "profile-save-button saved" : "profile-save-button"}
          type="button"
          disabled={saveStatus === "saving"}
          onClick={() => void onSaveProfile()}
        >
          {saveStatus === "saving" ? "SAVING..." : saveStatus === "saved" ? "✓ SAVED" : "SAVE PROFILE"}
        </button>
      </section>

      <section className="panel-block friend-list">
        <p className="panel-label">[ACTIVE_AGENTS]</p>
        {friends.length === 0 ? (
          <div className="empty-state">NO FRIENDS ONLINE</div>
        ) : (
          friends.map(([uid, friend]) => {
            const distance = currentLocation && friend.location
              ? getDistance(currentLocation.lat, currentLocation.lng, friend.location.lat, friend.location.lng)
              : null;
            const battery = friend.location?.battery;

            return (
              <button
                className="friend-row"
                key={uid}
                type="button"
                aria-disabled={!friend.location}
                title={friend.location ? undefined : "GPS not shared"}
                onClick={() => {
                  if (friend.location) onFocusFriend(friend.location);
                }}
              >
                <div>
                  <span
                    className="friend-beacon"
                    style={{ background: getFriendStatusColor(friend.location?.updatedAt ?? friend.updatedAt, now) }}
                  />
                  <strong>{friend.emoji} {friend.name.split(" ")[0]}</strong>
                  <small className="friend-stage">
                    {friend.location ? getNearestStage(friend.location.lat, friend.location.lng) : "ONLINE"}
                  </small>
                  <small style={{ color: getDistanceColor(distance) }}>
                    {distance === null ? "— away" : getSmartDistance(distance)}
                  </small>
                  {typeof battery === "number" && battery < 20 && (
                    <small style={{ color: "#FF4444" }}>🪫 {battery}%</small>
                  )}
                </div>
                <time>{friend.location ? formatAge(friend.location.updatedAt, now) : "ONLINE"}</time>
              </button>
            );
          })
        )}
      </section>

      <section className="panel-block">
        <InstallAppSection
          installAvailable={installAvailable}
          isIOS={isIOS}
          isInStandaloneMode={isInStandaloneMode}
          onInstall={onInstall}
        />
      </section>

      <section className="panel-block">
        <PushNotificationsSection
          status={pushStatus}
          isBusy={pushBusy}
          isIOS={isIOS}
          isInStandaloneMode={isInStandaloneMode}
          onEnablePush={onEnablePush}
        />
      </section>

      <button className="logout-button" type="button" onClick={onLogout}>
        LOGOUT
      </button>
    </aside>
  );
}

function PulseChooser({
  friends,
  open,
  selectedUids,
  onClose,
  onSendAll,
  onSendSelected,
  onToggleTarget,
}: {
  friends: [string, FriendSignal][];
  open: boolean;
  selectedUids: Set<string>;
  onClose: () => void;
  onSendAll: () => void;
  onSendSelected: () => void;
  onToggleTarget: (uid: string) => void;
}) {
  if (!open) return null;

  return (
    <div className="pulse-choice-backdrop" role="presentation">
      <section className="pulse-choice" role="dialog" aria-modal="true" aria-labelledby="pulse-choice-title">
        <div className="pulse-choice-header">
          <div>
            <span>[PULSE_TARGET]</span>
            <h2 id="pulse-choice-title">SEND PULSE</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close pulse choice">
            ×
          </button>
        </div>

        <button className="pulse-choice-all" type="button" onClick={onSendAll}>
          SEND TO ALL
        </button>

        <div className="pulse-choice-list" aria-label="Select recipients">
          {friends.length === 0 ? (
            <div className="empty-state">NO FRIENDS ONLINE</div>
          ) : (
            friends.map(([uid, friend]) => (
              <label className="pulse-choice-row" key={uid}>
                <input
                  checked={selectedUids.has(uid)}
                  onChange={() => onToggleTarget(uid)}
                  type="checkbox"
                />
                <span>{friend.emoji}</span>
                <strong>{friend.name.split(" ")[0]}</strong>
                <small>{friend.location ? getNearestStage(friend.location.lat, friend.location.lng) : "ONLINE"}</small>
              </label>
            ))
          )}
        </div>

        <button
          className="pulse-choice-selected"
          type="button"
          disabled={selectedUids.size === 0}
          onClick={onSendSelected}
        >
          SEND SELECTED
        </button>
      </section>
    </div>
  );
}

function MobileMenu({
  open,
  emoji,
  gpsInterval,
  emojis,
  displayName,
  profileName,
  userEmail,
  saveStatus,
  installAvailable,
  isIOS,
  isInStandaloneMode,
  pushStatus,
  pushBusy,
  onClose,
  onEmojiChange,
  onGpsIntervalChange,
  onLogout,
  onNameChange,
  onSaveProfile,
  onInstall,
  onEnablePush,
  isEmojiLocked,
}: {
  open: boolean;
  emoji: string;
  gpsInterval: GpsInterval;
  emojis: string[];
  displayName: string;
  profileName: string;
  userEmail: string;
  saveStatus: SaveStatus;
  installAvailable: boolean;
  isIOS: boolean;
  isInStandaloneMode: boolean;
  pushStatus: PushStatus;
  pushBusy: boolean;
  onClose: () => void;
  onEmojiChange: (emoji: string) => void | Promise<void>;
  onGpsIntervalChange: (interval: GpsInterval) => void;
  onLogout: () => void;
  onNameChange: (name: string) => void;
  onSaveProfile: () => void | Promise<void>;
  onInstall: () => void | Promise<void>;
  onEnablePush: () => void | Promise<void>;
  isEmojiLocked: (emoji: string) => boolean;
}) {
  const [view, setView] = useState<"menu" | "profile" | "settings">("menu");

  useEffect(() => {
    if (!open) return;

    const timeout = window.setTimeout(() => {
      setView("menu");
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [open]);

  const handleBack = () => {
    setView("menu");
  };

  return (
    <aside className={open ? "mobile-menu open" : "mobile-menu"} aria-hidden={!open}>
      <div className="mobile-menu-header">
        {view !== "menu" && (
          <button className="mobile-menu-back" type="button" onClick={handleBack} aria-label="Back to menu">
            ←
          </button>
        )}
        <div>
          <span>{view === "menu" ? "MENU" : view === "profile" ? "PROFILE" : "SETTINGS"}</span>
          <strong>{view === "menu" ? displayName : view === "profile" ? "MY MAP ICON" : "APP CONTROLS"}</strong>
        </div>
        <button type="button" onClick={onClose} aria-label="Close menu">
          ×
        </button>
      </div>

      {view === "menu" && (
        <section className="mobile-menu-actions" aria-label="Menu actions">
          <button type="button" onClick={() => setView("profile")}>
            <span>▣</span>
            <strong>PROFILE</strong>
            <small>Name and map emoji</small>
          </button>
          <button type="button" onClick={() => setView("settings")}>
            <span>⚙</span>
            <strong>SETTINGS</strong>
            <small>GPS mode</small>
          </button>
          <button className="danger" type="button" onClick={onLogout}>
            <span>⏻</span>
            <strong>LOGOUT</strong>
            <small>{userEmail}</small>
          </button>
        </section>
      )}

      {view === "profile" && (
        <section className="mobile-menu-section">
          <p className="panel-label">[PROFILE]</p>
          <div className="profile-row menu-profile-preview">
            <div className="avatar">{emoji}</div>
            <div>
              <strong>{displayName}</strong>
              <span>{userEmail}</span>
            </div>
          </div>
          <label className="profile-field">
            <span>DISPLAY NAME</span>
            <input
              value={profileName}
              onChange={(event) => {
                onNameChange(event.target.value.slice(0, 20));
              }}
              maxLength={20}
              placeholder="Your name"
              type="text"
            />
          </label>
          <p className="panel-label">[MAP_ICON]</p>
          <div className="marker-grid compact">
            {emojis.map((item) => (
              <button
                key={item}
                className={item === emoji ? "selected" : ""}
                type="button"
                aria-pressed={item === emoji}
                disabled={isEmojiLocked(item)}
                title={isEmojiLocked(item) ? "Already chosen" : undefined}
                onClick={() => {
                  void onEmojiChange(item);
                }}
              >
                {item}
              </button>
            ))}
          </div>
          <button
            className={saveStatus === "saved" ? "profile-save-button saved" : "profile-save-button"}
            type="button"
            disabled={saveStatus === "saving"}
            onClick={() => void onSaveProfile()}
          >
            {saveStatus === "saving" ? "SAVING..." : saveStatus === "saved" ? "✓ SAVED" : "SAVE PROFILE"}
          </button>
        </section>
      )}

      {view === "settings" && (
        <section className="mobile-menu-section">
          <GpsModeControl gpsInterval={gpsInterval} onGpsIntervalChange={onGpsIntervalChange} />
          <InstallAppSection
            installAvailable={installAvailable}
            isIOS={isIOS}
            isInStandaloneMode={isInStandaloneMode}
            onInstall={onInstall}
          />
          <PushNotificationsSection
            status={pushStatus}
            isBusy={pushBusy}
            isIOS={isIOS}
            isInStandaloneMode={isInStandaloneMode}
            onEnablePush={onEnablePush}
          />
        </section>
      )}
    </aside>
  );
}

function MobileRadar({
  currentLocation,
  friends,
  open,
  tick,
  now,
  activeFriend,
  meetingPoint,
  onFocusFriend,
  onFocusMeetingPoint,
  onToggleOpen,
}: {
  currentLocation?: FriendLocation;
  friends: [string, FriendSignal][];
  open: boolean;
  tick: number;
  now: number;
  activeFriend: string | null;
  meetingPoint: MeetingPoint | null;
  onFocusFriend: (uid: string, friend: FriendLocation) => void;
  onFocusMeetingPoint: () => void;
  onToggleOpen: () => void;
}) {
  return (
    <aside className={open ? "mobile-radar open" : "mobile-radar"}>
      <button
        className="drawer-handle"
        type="button"
        onClick={onToggleOpen}
        aria-expanded={open}
        aria-label={open ? "Close friend radar" : "Open friend radar"}
      >
        <span />
      </button>
      <div className="drawer-title">
        <h2>Friend Radar</h2>
        <p>{friends.length} connected</p>
      </div>
      <span hidden>{tick}</span>
      {meetingPoint && (
        <button className="meet-radar-banner" type="button" onClick={onFocusMeetingPoint}>
          📍 MEET: {meetingPoint.label} — set by {meetingPoint.setBy}
        </button>
      )}
      <div className="mobile-friends">
        {friends.length === 0 ? (
          <div className="mobile-empty">NO FRIENDS ONLINE</div>
        ) : (
          friends.map(([uid, friend]) => {
            const updatedAt = friend.location?.updatedAt ?? friend.updatedAt;
            const diffMin = Math.floor((now - updatedAt) / 60000);
            const distance = currentLocation && friend.location
              ? getDistance(currentLocation.lat, currentLocation.lng, friend.location.lat, friend.location.lng)
              : null;
            const distanceText = distance === null ? "— away" : getSmartDistance(distance);
            const battery = friend.location?.battery;

            return (
              <button
                className="mobile-friend"
                key={uid}
                style={{
                  outline: activeFriend === uid ? "1px solid #CCFF00" : "1px solid transparent",
                }}
                type="button"
                aria-disabled={!friend.location}
                title={friend.location ? undefined : "GPS not shared"}
                onClick={() => {
                  if (friend.location) onFocusFriend(uid, friend.location);
                }}
              >
                <div className="mobile-friend-avatar">
                  {friend.emoji}
                  <span
                    className="friend-status-dot"
                    style={{ background: getFriendStatusColor(updatedAt, now) }}
                  />
                </div>
                <span>{friend.name.split(" ")[0]}</span>
                <small
                  style={{
                    fontFamily: "monospace",
                    fontSize: "0.7rem",
                    color: getDistanceColor(distance),
                  }}
                >
                  {distanceText}
                </small>
                {typeof battery === "number" && battery < 20 && (
                  <small
                    style={{
                      color: "#FF4444",
                      fontFamily: "monospace",
                      fontSize: "0.65rem",
                    }}
                  >
                    🪫 {battery}%
                  </small>
                )}
                <small
                  style={{
                    fontFamily: "monospace",
                    fontSize: "0.65rem",
                    color: diffMin < 2 ? "#CCFF00" : diffMin < 10 ? "#FF6B00" : "#666",
                  }}
                >
                  {getLastSeen(updatedAt, now)}
                </small>
                <small>{friend.location ? getNearestStage(friend.location.lat, friend.location.lng) : "GPS MUTED"}</small>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}
