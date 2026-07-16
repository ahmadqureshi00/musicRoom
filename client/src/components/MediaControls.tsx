"use client";

// ─── Media Controls Component ─────────────────────────────────
// Play/Pause, Seek slider, and Next track controls (host-only).

import React, { useState, useRef, useCallback, useEffect } from "react";
import { useSocketContext } from "@/context/SocketContext";
import { formatTime, extractVideoId } from "@/lib/utils";

interface MediaControlsProps {
  currentTime: number;
  duration: number;
  playerState: number;
  onPlay: () => void;
  onPause: () => void;
  onSeek: (time: number) => void;
  onLoadVideo: (videoId: string) => void;
}

export default function MediaControls({
  currentTime,
  duration,
  playerState,
  onPlay,
  onPause,
  onSeek,
  onLoadVideo,
}: MediaControlsProps) {
  const {
    isHost,
    roomState,
    emitIntentSeek,
    emitTrackChanged,
    emitPlayNext,
  } = useSocketContext();

  const [urlInput, setUrlInput] = useState("");
  const [isSeeking, setIsSeeking] = useState(false);
  const [seekValue, setSeekValue] = useState(0);
  const sliderRef = useRef<HTMLInputElement>(null);

  const isPlaying = playerState === 1;
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  // ─── Play/Pause Toggle ─────────────────────────────────────
  const handlePlayPause = useCallback(() => {
    if (!isHost) return;
    if (isPlaying) {
      onPause();
    } else {
      onPlay();
    }
  }, [isHost, isPlaying, onPlay, onPause]);

  // ─── Seek ──────────────────────────────────────────────────
  const handleSeekStart = useCallback(() => {
    if (!isHost) return;
    setIsSeeking(true);
  }, [isHost]);

  const handleSeekChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!isHost) return;
      setSeekValue(parseFloat(e.target.value));
    },
    [isHost]
  );

  const handleSeekEnd = useCallback(() => {
    if (!isHost) return;
    setIsSeeking(false);
    const seekTime = (seekValue / 100) * duration;
    onSeek(seekTime);
    emitIntentSeek(seekTime);
  }, [isHost, seekValue, duration, onSeek, emitIntentSeek]);

  // ─── Load URL ──────────────────────────────────────────────
  const handleLoadUrl = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!isHost || !urlInput.trim()) return;

      const videoId = extractVideoId(urlInput.trim());
      if (!videoId) return;

      onLoadVideo(videoId);
      emitTrackChanged(videoId, urlInput.trim());
      setUrlInput("");
    },
    [isHost, urlInput, onLoadVideo, emitTrackChanged]
  );

  // ─── Play Next from Queue ─────────────────────────────────
  const handlePlayNext = useCallback(() => {
    if (!isHost) return;
    emitPlayNext();
  }, [isHost, emitPlayNext]);

  // Update seek slider position when not actively seeking
  useEffect(() => {
    if (!isSeeking) {
      setSeekValue(progress);
    }
  }, [progress, isSeeking]);

  return (
    <div className="media-controls">
      {/* URL Input (Host only) */}
      {isHost && (
        <form onSubmit={handleLoadUrl} className="url-input-form">
          <div className="url-input-wrapper">
            <svg
              className="url-input-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
            <input
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="Paste a YouTube URL to play..."
              className="url-input"
              id="url-input"
            />
            <button
              type="submit"
              className="url-submit-btn"
              disabled={!urlInput.trim()}
              id="play-url-btn"
            >
              Play
            </button>
          </div>
        </form>
      )}

      {/* Playback Controls */}
      <div className="controls-bar">
        {/* Play/Pause */}
        {isHost ? (
          <button
            className="play-pause-btn"
            onClick={handlePlayPause}
            id="play-pause-btn"
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? (
              <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
                <polygon points="5,3 19,12 5,21" />
              </svg>
            )}
          </button>
        ) : (
          <div className="play-pause-btn guest-indicator">
            {isPlaying ? (
              <div className="now-playing-indicator">
                <span className="bar"></span>
                <span className="bar"></span>
                <span className="bar"></span>
              </div>
            ) : (
              <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24" opacity={0.5}>
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
            )}
          </div>
        )}

        {/* Time + Slider */}
        <span className="time-label">{formatTime(isSeeking ? (seekValue / 100) * duration : currentTime)}</span>

        <div className="seek-slider-wrapper">
          <div className="seek-track">
            <div
              className="seek-fill"
              style={{ width: `${isSeeking ? seekValue : progress}%` }}
            />
          </div>
          <input
            ref={sliderRef}
            type="range"
            min="0"
            max="100"
            step="0.1"
            value={isSeeking ? seekValue : progress}
            className="seek-slider"
            onMouseDown={handleSeekStart}
            onTouchStart={handleSeekStart}
            onChange={handleSeekChange}
            onMouseUp={handleSeekEnd}
            onTouchEnd={handleSeekEnd}
            disabled={!isHost}
            id="seek-slider"
          />
        </div>

        <span className="time-label">{formatTime(duration)}</span>

        {/* Next Track */}
        {isHost && (
          <button
            className="next-btn"
            onClick={handlePlayNext}
            disabled={!roomState?.queue?.length}
            id="next-track-btn"
            aria-label="Next track"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
              <polygon points="4,3 16,12 4,21" />
              <rect x="17" y="3" width="3" height="18" rx="1" />
            </svg>
          </button>
        )}
      </div>

      {/* Now Playing Info */}
      {roomState?.currentVideoTitle && (
        <div className="now-playing-info">
          <span className="now-playing-label">Now Playing</span>
          <span className="now-playing-title">
            {roomState.currentVideoTitle}
          </span>
        </div>
      )}
    </div>
  );
}
