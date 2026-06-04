"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { signInWithRedirect, signOut } from "firebase/auth";
import { auth, provider } from "@/lib/firebase";
import { useAuth } from "@/hooks/useAuth";
import { FriendLocation, useLocation } from "@/hooks/useLocation";
import { getNearestStage } from "@/components/Map";

const Map = dynamic(() => import("@/components/Map"), {
  ssr: false,
  loading: () => <div className="map-loading">INITIALIZING RADAR</div>,
});

const EMOJIS = ["🔥", "⚡", "🎯", "👾", "💀", "🌀", "🐍", "🦊"];
const FRESH_MS = 10 * 60 * 1000;

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
  const [sharing, setSharing] = useState(false);
  const [locations, setLocations] = useState<Record<string, FriendLocation>>({});
  const [emoji, setEmoji] = useState("🔥");
  const [query, setQuery] = useState("");
  const [authError, setAuthError] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const handleUpdate = useCallback((data: Record<string, FriendLocation>) => {
    setLocations(data);
  }, []);

  useLocation(Boolean(user), sharing, emoji, handleUpdate);

  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(intervalId);
  }, []);

  const liveEntries = useMemo(
    () =>
      Object.entries(locations)
        .filter(([, loc]) => now - loc.updatedAt <= FRESH_MS)
        .sort(([, a], [, b]) => b.updatedAt - a.updatedAt),
    [locations, now]
  );

  const friends = useMemo(
    () =>
      liveEntries
        .filter(([uid]) => uid !== user?.uid)
        .filter(([, loc]) => loc.name.toLowerCase().includes(query.toLowerCase())),
    [liveEntries, query, user?.uid]
  );

  const currentLocation = user ? locations[user.uid] : undefined;
  const currentStage = sharing && currentLocation ? getNearestStage(currentLocation.lat, currentLocation.lng) : "";

  async function handleLogin() {
    setAuthError("");
    try {
      await signInWithRedirect(auth, provider);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Login non riuscito.");
    }
  }

  async function handleLogout() {
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
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <div className="noise-layer" />

      <header className="top-bar">
        <button
          className="icon-button mobile-only"
          type="button"
          aria-label={panelOpen ? "Chiudi pannello" : "Apri pannello"}
          onClick={() => setPanelOpen((value) => !value)}
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
          onClick={() => setSharing((value) => !value)}
        >
          <span className={sharing ? "status-dot on" : "status-dot"} />
          {sharing ? "LIVE" : "GO LIVE"}
        </button>
      </header>

      <div className="workspace">
        <section className="map-stage" id="map" aria-label="Mappa live">
          <div className="map-frame">
            <Map locations={locations} currentUid={user.uid} />
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
            aria-pressed={sharing}
            onClick={() => setSharing((value) => !value)}
          >
            <span>{sharing ? "STOP" : "SEND"}</span>
            <strong>PULSE</strong>
          </button>

          <MobileRadar
            friends={friends}
            currentLocation={currentLocation}
            open={panelOpen}
            sharing={sharing}
            onToggleOpen={() => setPanelOpen((value) => !value)}
          />
        </section>

        <CommandCenter
          currentLocation={currentLocation}
          friends={friends}
          emoji={emoji}
          emojis={EMOJIS}
          now={now}
          sharing={sharing}
          userName={user.displayName ?? "Anonimo"}
          userEmail={user.email ?? "Nessuna email"}
          onLogout={handleLogout}
          onEmojiChange={setEmoji}
          onSharingChange={() => setSharing((value) => !value)}
        />
      </div>

      <nav className="bottom-nav" aria-label="Navigazione mobile">
        <a className="active" href="#map" aria-label="Mappa">
          ⌖
        </a>
        <button type="button" aria-label="Friend radar" onClick={() => setPanelOpen(true)}>
          ◎
        </button>
        <button type="button" aria-label="Condivisione" onClick={() => setSharing((value) => !value)}>
          {sharing ? "◉" : "○"}
        </button>
        <button type="button" aria-label="Logout" onClick={handleLogout}>
          ⇥
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
  sharing,
  userName,
  userEmail,
  onLogout,
  onEmojiChange,
  onSharingChange,
}: {
  currentLocation?: FriendLocation;
  friends: [string, FriendLocation][];
  emoji: string;
  emojis: string[];
  now: number;
  sharing: boolean;
  userName: string;
  userEmail: string;
  onLogout: () => void;
  onEmojiChange: (emoji: string) => void;
  onSharingChange: () => void;
}) {
  return (
    <aside className="command-center" id="radar">
      <div className="command-action">
        <button className="command-pulse" type="button" onClick={onSharingChange}>
          <span>⌁</span>
          {sharing ? "STOP PULSE" : "SEND PULSE"}
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
              onClick={() => onEmojiChange(item)}
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
            <div className="friend-row" key={uid}>
              <div>
                <span className="friend-beacon" />
                <strong>{friend.emoji} {friend.name.split(" ")[0]}</strong>
                <small className="friend-stage">{getNearestStage(friend.lat, friend.lng)}</small>
                <small>{formatDistance(currentLocation, friend)} AWAY</small>
              </div>
              <time>{formatAge(friend.updatedAt, now)}</time>
            </div>
          ))
        )}
      </section>

      <button className="logout-button" type="button" onClick={onLogout}>
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
  onToggleOpen,
}: {
  currentLocation?: FriendLocation;
  friends: [string, FriendLocation][];
  open: boolean;
  sharing: boolean;
  onToggleOpen: () => void;
}) {
  return (
    <aside className={open ? "mobile-radar open" : "mobile-radar"}>
      <button className="drawer-handle" type="button" onClick={onToggleOpen} aria-label="Apri friend radar">
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
            <div className="mobile-friend" key={uid}>
              <div>{friend.emoji}</div>
              <span>{friend.name.split(" ")[0]} · {formatDistance(currentLocation, friend)}</span>
              <small>{getNearestStage(friend.lat, friend.lng)}</small>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
