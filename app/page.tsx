"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { signInWithRedirect, signOut } from "firebase/auth";
import { get, off, onChildAdded, onValue, push, ref, remove, runTransaction, serverTimestamp, set } from "firebase/database";
import { auth, db, provider } from "@/lib/firebase";
import { useAuth } from "@/hooks/useAuth";
import { FriendLocation, useLocation } from "@/hooks/useLocation";
import { getNearestStage } from "@/components/Map";

const Map = dynamic(() => import("@/components/Map"), {
  ssr: false,
  loading: () => <div className="map-loading">INITIALIZING RADAR</div>,
});

const EMOJIS = [
  "🔥", "⚡", "🎯", "👾", "💀", "🌀", "🐍", "🦊",
  "👸", "🦥", "🧔‍♂️", "🪩", "🧚", "🧙", "🤖", "👽",
  "🦄", "🌈", "🍒", "🧿", "🛸", "💎", "🫧", "🍄",
];
const FRESH_MS = 10 * 60 * 1000;

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

function formatDistance(from: FriendLocation | undefined, to: FriendLocation) {
  if (!from) return "--";
  return `${Math.round(getDistance(from.lat, from.lng, to.lat, to.lng))}M`;
}

export default function Home() {
  const { user, loading } = useAuth();
  const isFirstLoad = useRef(true);
  const audioContextRef = useRef<AudioContext | null>(null);
  const pulseTimeoutRef = useRef<number | null>(null);
  const [sharing, setSharing] = useState(false);
  const [locations, setLocations] = useState<Record<string, FriendLocation>>({});
  const [localLocation, setLocalLocation] = useState<FriendLocation | undefined>();
  const [emoji, setEmoji] = useState("🔥");
  const [emojiLocks, setEmojiLocks] = useState<Record<string, string>>({});
  const [profileName, setProfileName] = useState("");
  const [query, setQuery] = useState("");
  const [authError, setAuthError] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [pulseAlert, setPulseAlert] = useState<{ from: string; emoji: string } | null>(null);
  const [pulseChooserOpen, setPulseChooserOpen] = useState(false);
  const [pulseTargetUids, setPulseTargetUids] = useState<Set<string>>(() => new Set());
  const [focusedLocation, setFocusedLocation] = useState<{ lat: number; lng: number; focusId: number } | null>(null);

  const handleUpdate = useCallback((data: Record<string, FriendLocation>) => {
    setLocations(data);
  }, []);

  const handleSelfUpdate = useCallback((location: FriendLocation) => {
    setLocalLocation(location);
  }, []);

  const displayName = profileName.trim() || user?.displayName || "Anonimo";

  useLocation(Boolean(user), sharing, emoji, displayName, handleUpdate, handleSelfUpdate);

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

  const isEmojiLocked = useCallback((item: string) => {
    const owner = emojiLocks[emojiKey(item)];
    return Boolean(user && owner && owner !== user.uid);
  }, [emojiLocks, user]);

  const handleEmojiChange = useCallback(async (nextEmoji: string) => {
    if (!user || isEmojiLocked(nextEmoji)) return;

    const previousEmoji = emoji;
    const nextKey = emojiKey(nextEmoji);
    const result = await runTransaction(ref(db, `emojiLocks/${nextKey}`), (currentOwner) => {
      if (currentOwner === null || currentOwner === user.uid) return user.uid;
      return;
    });

    if (!result.committed && result.snapshot.val() !== user.uid) return;

    setEmoji(nextEmoji);
    await set(ref(db, `profiles/${user.uid}`), {
      name: displayName,
      emoji: nextEmoji,
      updatedAt: serverTimestamp(),
    });

    const previousKey = emojiKey(previousEmoji);
    if (previousKey === nextKey) return;

    const previousRef = ref(db, `emojiLocks/${previousKey}`);
    const previousLock = await get(previousRef);
    if (previousLock.val() === user.uid) {
      await remove(previousRef);
    }
  }, [displayName, emoji, isEmojiLocked, user]);

  const handleSharingToggle = useCallback(() => {
    setSharing((value) => {
      const next = !value;
      if (!next) setLocalLocation(undefined);
      return next;
    });
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    return () => {
      if (pulseTimeoutRef.current) {
        window.clearTimeout(pulseTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    const timeout = window.setTimeout(() => {
      setProfileName(window.localStorage.getItem(`dt-profile-name-${user.uid}`) ?? user.displayName ?? "Anonimo");
      setEmoji(window.localStorage.getItem(`dt-profile-emoji-${user.uid}`) ?? "🔥");
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [user]);

  useEffect(() => {
    if (!user || !profileName.trim()) return;
    window.localStorage.setItem(`dt-profile-name-${user.uid}`, profileName.trim());
  }, [profileName, user]);

  useEffect(() => {
    if (!user) return;
    window.localStorage.setItem(`dt-profile-emoji-${user.uid}`, emoji);
  }, [emoji, user]);

  useEffect(() => {
    if (!user) return;
    let timeout: number | undefined;

    const owner = emojiLocks[emojiKey(emoji)];
    if (!owner || owner === user.uid) {
      timeout = window.setTimeout(() => void handleEmojiChange(emoji), 0);
      return () => {
        if (timeout) window.clearTimeout(timeout);
      };
    }

    const fallbackEmoji = EMOJIS.find((item) => {
      const fallbackOwner = emojiLocks[emojiKey(item)];
      return !fallbackOwner || fallbackOwner === user.uid;
    });

    if (fallbackEmoji) {
      timeout = window.setTimeout(() => void handleEmojiChange(fallbackEmoji), 0);
    }

    return () => {
      if (timeout) window.clearTimeout(timeout);
    };
  }, [emoji, emojiLocks, handleEmojiChange, user]);

  useEffect(() => {
    if (!user) return;
    void set(ref(db, `profiles/${user.uid}`), {
      name: displayName,
      emoji,
      updatedAt: serverTimestamp(),
    });
  }, [displayName, emoji, user]);

  const playPulseSound = useCallback(() => {
    const AudioContextConstructor =
      window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (!AudioContextConstructor) return;

    const ctx = audioContextRef.current ?? new AudioContextConstructor();
    audioContextRef.current = ctx;

    const play = () => {
      [440, 550, 660].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = freq;
        osc.type = "sine";
        gain.gain.setValueAtTime(0.3, ctx.currentTime + i * 0.15);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.15 + 0.3);
        osc.start(ctx.currentTime + i * 0.15);
        osc.stop(ctx.currentTime + i * 0.15 + 0.3);
      });
    };

    if (ctx.state === "suspended") {
      void ctx.resume().then(play).catch(play);
    } else {
      play();
    }
  }, []);

  const triggerPulse = useCallback((name: string, pulseEmoji: string) => {
    if (navigator.vibrate) {
      navigator.vibrate([200, 100, 200, 100, 400]);
    }

    playPulseSound();

    setPulseAlert({ from: name, emoji: pulseEmoji });
    if (pulseTimeoutRef.current) {
      window.clearTimeout(pulseTimeoutRef.current);
    }
    pulseTimeoutRef.current = window.setTimeout(() => setPulseAlert(null), 2500);
  }, [playPulseSound]);

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

  const effectiveLocations = useMemo(() => {
    if (!user || !localLocation) return locations;
    return {
      ...locations,
      [user.uid]: localLocation,
    };
  }, [localLocation, locations, user]);

  const liveEntries = useMemo(
    () =>
      Object.entries(effectiveLocations)
        .filter(([, loc]) => now - loc.updatedAt <= FRESH_MS)
        .sort(([, a], [, b]) => b.updatedAt - a.updatedAt),
    [effectiveLocations, now]
  );

  const friends = useMemo(
    () =>
      liveEntries
        .filter(([uid]) => uid !== user?.uid)
        .filter(([, loc]) => loc.name.toLowerCase().includes(query.toLowerCase())),
    [liveEntries, query, user?.uid]
  );

  const currentLocation = user ? effectiveLocations[user.uid] : undefined;
  const currentStage = sharing && currentLocation ? getNearestStage(currentLocation.lat, currentLocation.lng) : "";

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

    triggerPulse(displayName, emoji);
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
    setFocusedLocation({
      lat: friend.lat,
      lng: friend.lng,
      focusId: Date.now(),
    });
    setPanelOpen(false);
    setMenuOpen(false);
  }, []);

  async function handleLogin() {
    setAuthError("");
    try {
      await signInWithRedirect(auth, provider);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Login non riuscito.");
    }
  }

  async function handleLogout() {
    setMenuOpen(false);
    setPanelOpen(false);
    setSharing(false);
    setLocalLocation(undefined);
    await signOut(auth);
  }

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
        </div>
      )}

      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <div className="noise-layer" />

      <header className="top-bar">
        <button
          className="icon-button mobile-only"
          type="button"
          aria-label={menuOpen ? "Chiudi menu" : "Apri menu"}
          onClick={() => {
            setMenuOpen((value) => !value);
            setPanelOpen(false);
          }}
        >
          ☰
        </button>
        <div className="brand-lockup">
          <span>DISTORTION</span>
          <strong>TRACKER</strong>
        </div>
        <nav className="desktop-nav" aria-label="Sezioni">
          <a className="nav-item active" href="#map">
            <span>⌖</span> Live Map
          </a>
          <a className="nav-item" href="#radar">
            <span>◎</span> Friend Radar
          </a>
          <a className="nav-item" href="#profile">
            <span>▣</span> Profile
          </a>
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

      <div className="workspace">
        <section className="map-stage" id="map" aria-label="Mappa live">
          <div className="map-frame">
            <Map locations={effectiveLocations} currentUid={user.uid} focusedLocation={focusedLocation} />
            <div className="scanline-layer" />
            <div className="radar-sweep" />
          </div>

          <div className="map-floating">
            <label className="search-box">
              <span>⌕</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="LOCATE FRIEND"
                type="search"
              />
            </label>
            <div className="map-tools" aria-label="Stato mappa">
              <span>{liveEntries.length} LIVE</span>
              <span>{sharing ? "GPS ACTIVE" : "GPS MUTED"}</span>
            </div>
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
            sharing={sharing}
            onFocusFriend={handleFocusFriend}
            onToggleOpen={() => setPanelOpen((value) => !value)}
          />
        </section>

        <CommandCenter
          currentLocation={currentLocation}
          friends={friends}
          emoji={emoji}
          emojis={EMOJIS}
          now={now}
          profileName={profileName}
          userName={displayName}
          userEmail={user.email ?? "Nessuna email"}
          onLogout={handleLogout}
          onNameChange={setProfileName}
          onEmojiChange={handleEmojiChange}
          onFocusFriend={handleFocusFriend}
          onSendPulse={handleOpenPulseChooser}
          isEmojiLocked={isEmojiLocked}
        />
      </div>

      <MobileMenu
        open={menuOpen}
        emoji={emoji}
        emojis={EMOJIS}
        displayName={displayName}
        profileName={profileName}
        userEmail={user.email ?? "Nessuna email"}
        onClose={() => setMenuOpen(false)}
        onEmojiChange={handleEmojiChange}
        onLogout={handleLogout}
        onNameChange={setProfileName}
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

      <nav className="bottom-nav" aria-label="Navigazione mobile">
        <button
          className={panelOpen ? "active" : ""}
          type="button"
          aria-label={panelOpen ? "Chiudi friend radar" : "Apri friend radar"}
          onClick={() => {
            setPanelOpen((value) => !value);
            setMenuOpen(false);
          }}
        >
          <span>◎</span>
          <small>Radar</small>
        </button>
        <button type="button" aria-label="Invia pulse" onClick={handleOpenPulseChooser}>
          <span>⌁</span>
          <small>Pulse</small>
        </button>
        <button
          className={sharing ? "active" : ""}
          type="button"
          aria-label={sharing ? "Interrompi condivisione" : "Avvia condivisione"}
          onClick={handleSharingToggle}
        >
          <span>{sharing ? "◉" : "○"}</span>
          <small>{sharing ? "Live" : "Go live"}</small>
        </button>
        <button
          className={menuOpen ? "active" : ""}
          type="button"
          aria-label={menuOpen ? "Chiudi menu" : "Apri menu"}
          onClick={() => {
            setMenuOpen((value) => !value);
            setPanelOpen(false);
          }}
        >
          <span>☰</span>
          <small>Menu</small>
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
      <section className="login-content" aria-label="Accesso Distortion Tracker">
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

function CommandCenter({
  currentLocation,
  friends,
  emoji,
  emojis,
  now,
  profileName,
  userName,
  userEmail,
  onLogout,
  onNameChange,
  onEmojiChange,
  onFocusFriend,
  onSendPulse,
  isEmojiLocked,
}: {
  currentLocation?: FriendLocation;
  friends: [string, FriendLocation][];
  emoji: string;
  emojis: string[];
  now: number;
  profileName: string;
  userName: string;
  userEmail: string;
  onLogout: () => void;
  onNameChange: (name: string) => void;
  onEmojiChange: (emoji: string) => void | Promise<void>;
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
            onChange={(event) => onNameChange(event.target.value)}
            maxLength={24}
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
        <p className="panel-label">[EMOJI_SELECT]</p>
        <div className="marker-grid">
          {emojis.map((item) => (
            <button
              key={item}
              className={item === emoji ? "selected" : ""}
              type="button"
              aria-pressed={item === emoji}
              disabled={isEmojiLocked(item)}
              title={isEmojiLocked(item) ? "Gia scelta" : undefined}
              onClick={() => void onEmojiChange(item)}
            >
              {item}
            </button>
          ))}
        </div>
      </section>

      <section className="panel-block friend-list">
        <p className="panel-label">[ACTIVE_AGENTS]</p>
        {friends.length === 0 ? (
          <div className="empty-state">NO FRIEND SIGNALS</div>
        ) : (
          friends.map(([uid, friend]) => (
            <button className="friend-row" key={uid} type="button" onClick={() => onFocusFriend(friend)}>
              <div>
                <span className="friend-beacon" />
                <strong>{friend.emoji} {friend.name.split(" ")[0]}</strong>
                <small className="friend-stage">{getNearestStage(friend.lat, friend.lng)}</small>
                <small>{formatDistance(currentLocation, friend)} AWAY</small>
              </div>
              <time>{formatAge(friend.updatedAt, now)}</time>
            </button>
          ))
        )}
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
  friends: [string, FriendLocation][];
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
          <button type="button" onClick={onClose} aria-label="Chiudi scelta pulse">
            ×
          </button>
        </div>

        <button className="pulse-choice-all" type="button" onClick={onSendAll}>
          INVIA A TUTTI
        </button>

        <div className="pulse-choice-list" aria-label="Seleziona destinatari">
          {friends.length === 0 ? (
            <div className="empty-state">NO FRIEND SIGNALS</div>
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
                <small>{getNearestStage(friend.lat, friend.lng)}</small>
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
          INVIA AI SELEZIONATI
        </button>
      </section>
    </div>
  );
}

function MobileMenu({
  open,
  emoji,
  emojis,
  displayName,
  profileName,
  userEmail,
  onClose,
  onEmojiChange,
  onLogout,
  onNameChange,
  isEmojiLocked,
}: {
  open: boolean;
  emoji: string;
  emojis: string[];
  displayName: string;
  profileName: string;
  userEmail: string;
  onClose: () => void;
  onEmojiChange: (emoji: string) => void | Promise<void>;
  onLogout: () => void;
  onNameChange: (name: string) => void;
  isEmojiLocked: (emoji: string) => boolean;
}) {
  return (
    <aside className={open ? "mobile-menu open" : "mobile-menu"} aria-hidden={!open}>
      <div className="mobile-menu-header">
        <div>
          <span>MENU</span>
          <strong>{displayName}</strong>
        </div>
        <button type="button" onClick={onClose} aria-label="Chiudi menu">
          ×
        </button>
      </div>

      <section className="mobile-menu-section">
        <p className="panel-label">[PROFILE]</p>
        <label className="profile-field">
          <span>DISPLAY NAME</span>
          <input
            value={profileName}
            onChange={(event) => onNameChange(event.target.value)}
            maxLength={24}
            type="text"
          />
        </label>
        <span className="menu-email">{userEmail}</span>
        <div className="marker-grid compact">
          {emojis.map((item) => (
            <button
              key={item}
              className={item === emoji ? "selected" : ""}
              type="button"
              aria-pressed={item === emoji}
              disabled={isEmojiLocked(item)}
              title={isEmojiLocked(item) ? "Gia scelta" : undefined}
              onClick={() => void onEmojiChange(item)}
            >
              {item}
            </button>
          ))}
        </div>
      </section>

      <section className="mobile-menu-section">
        <p className="panel-label">[SETTINGS]</p>
        <div className="empty-state">EMPTY</div>
      </section>

      <button className="logout-button mobile-menu-logout" type="button" onClick={onLogout}>
        LOGOUT
      </button>
    </aside>
  );
}

function MobileRadar({
  currentLocation,
  friends,
  open,
  sharing,
  onFocusFriend,
  onToggleOpen,
}: {
  currentLocation?: FriendLocation;
  friends: [string, FriendLocation][];
  open: boolean;
  sharing: boolean;
  onFocusFriend: (friend: FriendLocation) => void;
  onToggleOpen: () => void;
}) {
  return (
    <aside className={open ? "mobile-radar open" : "mobile-radar"}>
      <button
        className="drawer-handle"
        type="button"
        onClick={onToggleOpen}
        aria-expanded={open}
        aria-label={open ? "Chiudi friend radar" : "Apri friend radar"}
      >
        <span />
      </button>
      <div className="drawer-title">
        <h2>Friend Radar</h2>
        <p>{friends.length} connected</p>
      </div>
      <div className="mobile-friends">
        {friends.length === 0 ? (
          <div className="mobile-empty">{sharing ? "WAITING FOR SIGNALS" : "GO LIVE TO BROADCAST"}</div>
        ) : (
          friends.map(([uid, friend]) => (
            <button className="mobile-friend" key={uid} type="button" onClick={() => onFocusFriend(friend)}>
              <div>{friend.emoji}</div>
              <span>{friend.name.split(" ")[0]} · {formatDistance(currentLocation, friend)}</span>
              <small>{getNearestStage(friend.lat, friend.lng)}</small>
            </button>
          ))
        )}
      </div>
    </aside>
  );
}
