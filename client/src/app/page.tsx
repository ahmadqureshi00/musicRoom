"use client";

// ─── Landing Page ─────────────────────────────────────────────
// Home screen with "Create Party" and "Join Party" cards.

import React, { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useSocketContext } from "@/context/SocketContext";

export default function LandingPage() {
  const router = useRouter();
  const { isConnected, createRoom, joinRoom } = useSocketContext();

  const [hostName, setHostName] = useState("");
  const [guestName, setGuestName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [createError, setCreateError] = useState("");
  const [joinError, setJoinError] = useState("");

  const handleCreate = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!hostName.trim()) {
        setCreateError("Please enter your name");
        return;
      }
      setIsCreating(true);
      setCreateError("");
      try {
        const roomId = await createRoom(hostName.trim());
        router.push(`/room/${roomId}`);
      } catch (err: any) {
        setCreateError(err.message || "Failed to create room");
        setIsCreating(false);
      }
    },
    [hostName, createRoom, router]
  );

  const handleJoin = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!guestName.trim()) {
        setJoinError("Please enter your name");
        return;
      }
      if (!roomCode.trim()) {
        setJoinError("Please enter a Room ID");
        return;
      }
      setIsJoining(true);
      setJoinError("");
      try {
        await joinRoom(roomCode.trim().toUpperCase(), guestName.trim());
        router.push(`/room/${roomCode.trim().toUpperCase()}`);
      } catch (err: any) {
        setJoinError(err.message || "Room not found");
        setIsJoining(false);
      }
    },
    [guestName, roomCode, joinRoom, router]
  );

  return (
    <main className="landing-page">
      {/* Background Effects */}
      <div className="particles">
        {[...Array(8)].map((_, i) => (
          <div key={i} className="particle" />
        ))}
      </div>
      <div className="bg-orb bg-orb-1" />
      <div className="bg-orb bg-orb-2" />
      <div className="bg-orb bg-orb-3" />

      <div className="landing-content">
        {/* Logo */}
        <div className="logo">
          <span className="logo-icon">🎵</span>
          <h1 className="logo-text">MusicRoom</h1>
        </div>

        <p className="landing-subtitle">
          Create a room, share the code, and <strong>listen to music in perfect sync</strong> with your friends — no matter where they are.
        </p>

        {/* Connection indicator */}
        {!isConnected && (
          <div style={{ marginBottom: "1.5rem", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem" }}>
            <div className="spinner-small" />
            <span style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>Connecting to server...</span>
          </div>
        )}

        {/* Action Cards */}
        <div className="action-cards">
          {/* Create Party */}
          <div className="action-card">
            <span className="card-icon">🎉</span>
            <h2 className="card-title">Create Party</h2>
            <p className="card-description">
              Start a new listening room and invite your friends with a unique code.
            </p>
            <form onSubmit={handleCreate}>
              <div className="form-group">
                <input
                  type="text"
                  value={hostName}
                  onChange={(e) => setHostName(e.target.value)}
                  placeholder="Your display name"
                  className="form-input"
                  id="host-name-input"
                  maxLength={20}
                  autoComplete="off"
                />
              </div>
              <button
                type="submit"
                className="btn-primary"
                disabled={isCreating || !isConnected}
                id="create-party-btn"
              >
                {isCreating ? "Creating..." : "Create Party"}
              </button>
              {createError && <p className="form-error">{createError}</p>}
            </form>
          </div>

          {/* Join Party */}
          <div className="action-card">
            <span className="card-icon">🚀</span>
            <h2 className="card-title">Join Party</h2>
            <p className="card-description">
              Enter a Room ID shared by your friend to jump into an existing session.
            </p>
            <form onSubmit={handleJoin}>
              <div className="form-group">
                <input
                  type="text"
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  placeholder="Your display name"
                  className="form-input"
                  id="guest-name-input"
                  maxLength={20}
                  autoComplete="off"
                />
              </div>
              <div className="form-group">
                <input
                  type="text"
                  value={roomCode}
                  onChange={(e) =>
                    setRoomCode(e.target.value.toUpperCase())
                  }
                  placeholder="Room ID (e.g. ABC123)"
                  className="form-input"
                  id="room-code-input"
                  maxLength={6}
                  autoComplete="off"
                  style={{ letterSpacing: "0.15em", fontWeight: 600 }}
                />
              </div>
              <button
                type="submit"
                className="btn-primary"
                disabled={isJoining || !isConnected}
                id="join-party-btn"
              >
                {isJoining ? "Joining..." : "Join Party"}
              </button>
              {joinError && <p className="form-error">{joinError}</p>}
            </form>
          </div>
        </div>
      </div>
    </main>
  );
}
