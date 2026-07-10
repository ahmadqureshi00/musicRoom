"use client";

// ─── Sync Overlay Component ──────────────────────────────────
// Full-screen overlay for browser autoplay policy compliance.
// Shown on first load to capture a user gesture before playback.

import React from "react";

interface SyncOverlayProps {
  onSync: () => void;
}

export default function SyncOverlay({ onSync }: SyncOverlayProps) {
  return (
    <div className="sync-overlay" id="sync-overlay">
      <div className="sync-overlay-content">
        <div className="sync-pulse-ring">
          <div className="sync-pulse-ring-inner" />
        </div>
        <div className="sync-icon">🎵</div>
        <h2 className="sync-title">Ready to Join the Party?</h2>
        <p className="sync-subtitle">
          Tap the button below to sync your audio with the host
        </p>
        <button
          className="sync-button"
          onClick={onSync}
          id="sync-connect-btn"
        >
          <span className="sync-button-text">TAP TO SYNC & CONNECT</span>
          <div className="sync-button-shine" />
        </button>
        <p className="sync-note">
          This is required by your browser to enable audio playback
        </p>
      </div>
    </div>
  );
}
