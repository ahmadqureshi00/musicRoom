"use client";

// ─── Queue Panel Component ────────────────────────────────────
// Shared music queue sidebar with add-track functionality.

import React, { useState, useCallback } from "react";
import { useSocketContext } from "@/context/SocketContext";
import { extractVideoId, truncate } from "@/lib/utils";

export default function QueuePanel() {
  const { roomState, isHost, emitQueueAdd, emitPlayNext } = useSocketContext();
  const [urlInput, setUrlInput] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState("");

  const handleAddToQueue = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!urlInput.trim()) return;

      const videoId = extractVideoId(urlInput.trim());
      if (!videoId) {
        setError("Invalid YouTube URL");
        setTimeout(() => setError(""), 3000);
        return;
      }

      setIsAdding(true);
      setError("");

      try {
        const success = await emitQueueAdd(videoId, urlInput.trim());
        if (success) {
          setUrlInput("");
        } else {
          setError("Failed to add to queue");
        }
      } catch {
        setError("Failed to add to queue");
      } finally {
        setIsAdding(false);
      }
    },
    [urlInput, emitQueueAdd]
  );

  if (!roomState) return null;

  return (
    <div className="queue-panel">
      <div className="panel-header">
        <h3 className="panel-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
            <line x1="8" y1="6" x2="21" y2="6" />
            <line x1="8" y1="12" x2="21" y2="12" />
            <line x1="8" y1="18" x2="21" y2="18" />
            <line x1="3" y1="6" x2="3.01" y2="6" />
            <line x1="3" y1="12" x2="3.01" y2="12" />
            <line x1="3" y1="18" x2="3.01" y2="18" />
          </svg>
          Up Next
        </h3>
        <span className="guest-count">{roomState.queue.length}</span>
      </div>

      {/* Add to Queue */}
      <form onSubmit={handleAddToQueue} className="queue-add-form">
        <div className="queue-input-wrapper">
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="Add a YouTube URL to queue..."
            className="queue-input"
            id="queue-url-input"
          />
          <button
            type="submit"
            className="queue-add-btn"
            disabled={!urlInput.trim() || isAdding}
            id="queue-add-btn"
          >
            {isAdding ? (
              <div className="spinner-small" />
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            )}
          </button>
        </div>
        {error && <p className="queue-error">{error}</p>}
      </form>

      {/* Queue Items */}
      <div className="queue-items">
        {roomState.queue.length === 0 ? (
          <div className="queue-empty">
            <p className="queue-empty-text">Queue is empty</p>
            <p className="queue-empty-sub">Add tracks to keep the party going!</p>
          </div>
        ) : (
          roomState.queue.map((item, index) => (
            <div key={item.id} className="queue-item" style={{ animationDelay: `${index * 0.05}s` }}>
              <div className="queue-item-index">{index + 1}</div>
              <div className="queue-item-info">
                <span className="queue-item-title">
                  {truncate(item.title, 50)}
                </span>
                <span className="queue-item-added">
                  Added by {item.addedBy}
                </span>
              </div>
              {isHost && (
                <button
                  className="queue-item-play"
                  onClick={emitPlayNext}
                  title="Play this next"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                    <polygon points="5,3 19,12 5,21" />
                  </svg>
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
