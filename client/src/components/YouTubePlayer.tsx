"use client";

// ─── YouTube Player Component ─────────────────────────────────
// Wrapper around the YouTube Iframe Player with sync logic.

import React, { useEffect, useRef, useCallback } from "react";
import { useYouTubePlayer } from "@/hooks/useYouTubePlayer";
import { useSocketContext } from "@/context/SocketContext";

interface PlayerControlRef {
  play: () => void;
  pause: () => void;
  seek: (time: number) => void;
  loadVideo: (videoId: string) => void;
}

interface YouTubePlayerProps {
  onTimeUpdate?: (time: number) => void;
  onDurationChange?: (duration: number) => void;
  onStateChange?: (state: number) => void;
  onPlayerReady?: (controls: PlayerControlRef) => void;
}

export default function YouTubePlayer({
  onTimeUpdate,
  onDurationChange,
  onStateChange,
  onPlayerReady,
}: YouTubePlayerProps) {
  const {
    socket,
    roomState,
    isHost,
    emitSyncAction,
    emitHostState,
  } = useSocketContext();

  // Sync guard: prevents re-emitting events triggered by remote sync
  const isSyncingRef = useRef(false);
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleStateChange = useCallback(
    (state: number, currentTime: number) => {
      onStateChange?.(state);
      onTimeUpdate?.(currentTime);

      // If this state change was triggered by a remote sync, skip re-emitting
      if (isSyncingRef.current) return;

      // Only the host emits sync actions
      if (!isHost) return;

      // YT.PlayerState: PLAYING=1, PAUSED=2
      if (state === 1) {
        emitSyncAction("PLAY", currentTime);
      } else if (state === 2) {
        // Small delay to distinguish pause from seek
        if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
        syncTimeoutRef.current = setTimeout(() => {
          const time = getCurrentTime();
          emitSyncAction("PAUSE", time);
        }, 300);
      }
    },
    [isHost, emitSyncAction, onStateChange, onTimeUpdate]
  );

  const {
    isReady,
    currentTime,
    duration,
    playVideo,
    pauseVideo,
    seekTo,
    loadVideo,
    getCurrentTime,
    playerState,
  } = useYouTubePlayer({
    containerId: "yt-player-container",
    onStateChange: handleStateChange,
  });

  // Register control methods with parent once ready
  useEffect(() => {
    if (isReady) {
      onPlayerReady?.({
        play: playVideo,
        pause: pauseVideo,
        seek: seekTo,
        loadVideo,
      });
    }
  }, [isReady, playVideo, pauseVideo, seekTo, loadVideo, onPlayerReady]);

  // Expose time and duration updates
  useEffect(() => {
    onTimeUpdate?.(currentTime);
  }, [currentTime, onTimeUpdate]);

  useEffect(() => {
    onDurationChange?.(duration);
  }, [duration, onDurationChange]);

  // ─── Load video when roomState changes ─────────────────────
  useEffect(() => {
    if (!isReady || !roomState?.currentVideoId) return;
    loadVideo(roomState.currentVideoId);
  }, [isReady, roomState?.currentVideoId, loadVideo]);

  // ─── Listen for sync actions from server (Guest) ───────────
  useEffect(() => {
    if (!socket || isHost) return;

    const handleSyncAction = (data: {
      action: "PLAY" | "PAUSE" | "SEEK";
      currentTime: number;
    }) => {
      if (!isReady) return;

      isSyncingRef.current = true;

      if (data.action === "PLAY") {
        seekTo(data.currentTime);
        playVideo();
      } else if (data.action === "PAUSE") {
        pauseVideo();
        seekTo(data.currentTime);
      } else if (data.action === "SEEK") {
        seekTo(data.currentTime);
      }

      setTimeout(() => {
        isSyncingRef.current = false;
      }, 500);
    };

    const handleHostState = (data: {
      currentTime: number;
      isPlaying: boolean;
      videoId: string | null;
    }) => {
      if (!isReady) return;

      const localTime = getCurrentTime();
      const drift = Math.abs(localTime - data.currentTime);

      // Only correct if drift exceeds 1 second
      if (drift > 1) {
        isSyncingRef.current = true;
        seekTo(data.currentTime);
        setTimeout(() => {
          isSyncingRef.current = false;
        }, 500);
      }

      // Ensure play/pause state matches
      if (data.isPlaying && playerState !== 1) {
        isSyncingRef.current = true;
        playVideo();
        setTimeout(() => {
          isSyncingRef.current = false;
        }, 500);
      } else if (!data.isPlaying && playerState === 1) {
        isSyncingRef.current = true;
        pauseVideo();
        setTimeout(() => {
          isSyncingRef.current = false;
        }, 500);
      }
    };

    socket.on("sync_action", handleSyncAction);
    socket.on("host_state", handleHostState);

    return () => {
      socket.off("sync_action", handleSyncAction);
      socket.off("host_state", handleHostState);
    };
  }, [
    socket,
    isHost,
    isReady,
    seekTo,
    playVideo,
    pauseVideo,
    getCurrentTime,
    playerState,
  ]);

  // ─── Host: respond to sync requests ────────────────────────
  useEffect(() => {
    if (!socket || !isHost) return;

    const handleRequestSync = (data: { requesterId: string }) => {
      const time = getCurrentTime();
      emitHostState(
        data.requesterId,
        time,
        playerState === 1,
        roomState?.currentVideoId || null
      );
    };

    socket.on("request_sync", handleRequestSync);
    return () => {
      socket.off("request_sync", handleRequestSync);
    };
  }, [
    socket,
    isHost,
    getCurrentTime,
    playerState,
    roomState?.currentVideoId,
    emitHostState,
  ]);

  // ─── Guest: periodic drift correction (every 5 seconds) ───
  useEffect(() => {
    if (!socket || isHost || !isReady) return;

    const interval = setInterval(() => {
      socket.emit("request_sync");
    }, 5000);

    return () => clearInterval(interval);
  }, [socket, isHost, isReady]);

  return (
    <div className="youtube-player-wrapper">
      <div className="youtube-player-aspect">
        <div id="yt-player-container" className="youtube-player-inner" />
        {!roomState?.currentVideoId && (
          <div className="youtube-player-placeholder">
            <div className="placeholder-icon">🎵</div>
            <p className="placeholder-text">
              {isHost
                ? "Paste a YouTube URL below to start the party"
                : "Waiting for the host to play a track..."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
