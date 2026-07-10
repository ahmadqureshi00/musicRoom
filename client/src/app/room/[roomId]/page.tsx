"use client";

// ─── Room Page ────────────────────────────────────────────────
// The party dashboard with player, controls, guest list, and queue.

import React, { useState, useCallback, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import { SocketProvider, useSocketContext } from "@/context/SocketContext";
import YouTubePlayer from "@/components/YouTubePlayer";
import MediaControls from "@/components/MediaControls";
import GuestList from "@/components/GuestList";
import QueuePanel from "@/components/QueuePanel";
import SyncOverlay from "@/components/SyncOverlay";

// ─── Shared player control ref type ─────────────────────────
export interface PlayerControlRef {
  play: () => void;
  pause: () => void;
  seek: (time: number) => void;
  loadVideo: (videoId: string) => void;
}

export default function RoomPage() {
  const params = useParams();
  const roomId = params.roomId as string;

  const {
    socket,
    isConnected,
    roomState,
    isHost,
  } = useSocketContext();

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playerState, setPlayerState] = useState(-1);
  const [showSyncOverlay, setShowSyncOverlay] = useState(false);
  const [copied, setCopied] = useState(false);
  const [mobileTab, setMobileTab] = useState<"listeners" | "queue">("listeners");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  // Player control ref — set by YouTubePlayer, used by MediaControls
  const playerControlRef = useRef<PlayerControlRef | null>(null);

  // If we navigated here without room state (e.g. direct URL),
  // show message to go back
  useEffect(() => {
    if (roomState) {
      setIsLoading(false);
      if (!isHost) {
        setShowSyncOverlay(true);
      }
    } else {
      const timer = setTimeout(() => {
        if (!roomState) {
          setIsLoading(false);
          setError("no_state");
        }
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [roomState, isHost]);

  // Copy room ID to clipboard
  const handleCopyRoomId = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(roomId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const input = document.createElement("input");
      input.value = roomId;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [roomId]);

  // Sync overlay handler
  const handleSync = useCallback(() => {
    setShowSyncOverlay(false);
    playerControlRef.current?.play();
  }, []);

  // Player event callbacks
  const handleTimeUpdate = useCallback((time: number) => {
    setCurrentTime(time);
  }, []);

  const handleDurationChange = useCallback((dur: number) => {
    setDuration(dur);
  }, []);

  const handleStateChange = useCallback((state: number) => {
    setPlayerState(state);
  }, []);

  // Register player controls from YouTubePlayer
  const handlePlayerReady = useCallback((controls: PlayerControlRef) => {
    playerControlRef.current = controls;
  }, []);

  // Loading state
  if (isLoading) {
    return (
      <div className="loading-page">
        <div className="spinner" />
        <p className="loading-text">Connecting to room...</p>
      </div>
    );
  }

  // Error: no room state (direct URL visit)
  if (error === "no_state") {
    return (
      <div className="loading-page">
        <span style={{ fontSize: "4rem", marginBottom: "1rem" }}>🔗</span>
        <h2 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "0.5rem" }}>
          Room Not Connected
        </h2>
        <p className="loading-text" style={{ maxWidth: 360, textAlign: "center", lineHeight: 1.6 }}>
          Please go back to the home page and create or join a room to get connected.
        </p>
        <a
          href="/"
          style={{
            marginTop: "1.5rem",
            padding: "0.75rem 2rem",
            background: "var(--gradient-primary)",
            color: "white",
            borderRadius: "var(--radius-md)",
            textDecoration: "none",
            fontWeight: 600,
            fontSize: "0.9rem",
          }}
        >
          Go Home
        </a>
      </div>
    );
  }

  return (
    <div className="room-page">
      {/* Sync Overlay (Guests only) */}
      {showSyncOverlay && <SyncOverlay onSync={handleSync} />}

      {/* Header */}
      <header className="room-header">
        <div className="room-header-left">
          <a href="/" className="room-logo">🎵 MusicRoom</a>
          <button
            className="room-id-badge"
            onClick={handleCopyRoomId}
            title="Click to copy Room ID"
            id="room-id-badge"
          >
            <code>{roomId}</code>
            {copied ? (
              <span className="copied-tooltip">Copied!</span>
            ) : (
              <svg className="copy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            )}
          </button>
        </div>

        <div className="connection-status">
          <div className={`status-dot ${!isConnected ? "disconnected" : ""}`} />
          <span>{isConnected ? "Connected" : "Reconnecting..."}</span>
          {isHost && (
            <span style={{
              marginLeft: "0.5rem",
              padding: "0.125rem 0.5rem",
              background: "rgba(251, 191, 36, 0.1)",
              border: "1px solid rgba(251, 191, 36, 0.2)",
              borderRadius: "999px",
              color: "#fbbf24",
              fontSize: "0.7rem",
              fontWeight: 600,
            }}>
              HOST
            </span>
          )}
        </div>
      </header>

      {/* Mobile Tabs */}
      <div className="mobile-tabs mobile-only">
        <button
          className={`mobile-tab ${mobileTab === "listeners" ? "active" : ""}`}
          onClick={() => setMobileTab("listeners")}
        >
          👥 Listeners ({roomState?.guests.length || 0})
        </button>
        <button
          className={`mobile-tab ${mobileTab === "queue" ? "active" : ""}`}
          onClick={() => setMobileTab("queue")}
        >
          📋 Queue ({roomState?.queue.length || 0})
        </button>
      </div>

      {/* Main Body */}
      <div className="room-body">
        {/* Guest List — Desktop sidebar */}
        <div className="desktop-only">
          <GuestList />
        </div>

        {/* Center: Player + Controls */}
        <div className="player-area">
          <YouTubePlayer
            onTimeUpdate={handleTimeUpdate}
            onDurationChange={handleDurationChange}
            onStateChange={handleStateChange}
            onPlayerReady={handlePlayerReady}
          />

          <MediaControls
            currentTime={currentTime}
            duration={duration}
            playerState={playerState}
            onPlay={() => playerControlRef.current?.play()}
            onPause={() => playerControlRef.current?.pause()}
            onSeek={(t) => playerControlRef.current?.seek(t)}
            onLoadVideo={(id) => playerControlRef.current?.loadVideo(id)}
          />
        </div>

        {/* Queue — Desktop sidebar */}
        <div className="desktop-only">
          <QueuePanel />
        </div>
      </div>

      {/* Mobile Panel (toggleable) */}
      <div className="mobile-only mobile-panel">
        {mobileTab === "listeners" ? <GuestList /> : <QueuePanel />}
      </div>
    </div>
  );
}
