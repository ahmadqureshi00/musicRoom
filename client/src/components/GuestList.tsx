"use client";

// ─── Guest List Component ─────────────────────────────────────
// Displays connected participants with colored initials avatars.

import React from "react";
import { useSocketContext } from "@/context/SocketContext";

// Deterministic color from a string
function getAvatarColor(name: string): string {
  const colors = [
    "from-purple-500 to-pink-500",
    "from-blue-500 to-cyan-500",
    "from-green-500 to-emerald-500",
    "from-orange-500 to-red-500",
    "from-yellow-500 to-orange-500",
    "from-teal-500 to-blue-500",
    "from-pink-500 to-rose-500",
    "from-indigo-500 to-purple-500",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export default function GuestList() {
  const { roomState, isHost, socket } = useSocketContext();

  if (!roomState) return null;

  return (
    <div className="guest-list-panel">
      <div className="panel-header">
        <h3 className="panel-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
          Listeners
        </h3>
        <span className="guest-count">{roomState.guests.length}</span>
      </div>

      <div className="guest-list-items">
        {roomState.guests.map((guest, index) => {
          const isCurrentUser = guest.socketId === socket?.id;
          const isGuestHost = guest.socketId === roomState.hostId;

          return (
            <div
              key={guest.socketId}
              className={`guest-item ${isCurrentUser ? "guest-item-self" : ""}`}
              style={{ animationDelay: `${index * 0.05}s` }}
            >
              <div className={`guest-avatar bg-gradient-to-br ${getAvatarColor(guest.displayName)}`}>
                {getInitials(guest.displayName)}
              </div>
              <div className="guest-info">
                <span className="guest-name">
                  {guest.displayName}
                  {isCurrentUser && (
                    <span className="you-badge">you</span>
                  )}
                </span>
                {isGuestHost && (
                  <span className="host-badge">
                    <svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12">
                      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                    </svg>
                    Host
                  </span>
                )}
              </div>
              <div className="guest-status-dot" />
            </div>
          );
        })}
      </div>
    </div>
  );
}
