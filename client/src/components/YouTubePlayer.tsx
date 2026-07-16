"use client";

// ─── YouTube Player Component ─────────────────────────────────
// Wrapper around the YouTube Iframe Player with BeatSync-grade
// coordinated execution sync. All clients (including host)
// receive execute_playback events and trigger actions at the
// exact same server-time instant via scheduled setTimeout.

import React, { useEffect, useRef, useCallback } from "react";
import { useYouTubePlayer } from "@/hooks/useYouTubePlayer";
import {
  useSocketContext,
  ExecutePlaybackEvent,
} from "@/context/SocketContext";

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
    emitIntentPlay,
    emitIntentPause,
    emitHostState,
    getCurrentServerTime,
    getServerTimeOffset,
  } = useSocketContext();

  // Sync guard: prevents re-emitting events triggered by coordinated execution
  const isSyncingRef = useRef(false);
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // Track pending scheduled executions so we can cancel on new commands
  const pendingExecutionRef = useRef<NodeJS.Timeout | null>(null);

  const handleStateChange = useCallback(
    (state: number, currentTime: number) => {
      onStateChange?.(state);
      onTimeUpdate?.(currentTime);

      // If this state change was triggered by a coordinated execution, skip
      if (isSyncingRef.current) return;

      // Only the host emits intent events
      if (!isHost) return;

      // YT.PlayerState: PLAYING=1, PAUSED=2
      if (state === 1) {
        emitIntentPlay(currentTime);
      } else if (state === 2) {
        // Small delay to distinguish pause from seek
        if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
        syncTimeoutRef.current = setTimeout(() => {
          const time = getCurrentTime();
          emitIntentPause(time);
        }, 300);
      }
    },
    [isHost, emitIntentPlay, emitIntentPause, onStateChange, onTimeUpdate]
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
    setPlaybackRate,
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

  // ═══════════════════════════════════════════════════════════
  // ─── COORDINATED EXECUTION: execute_playback listener ──────
  // ═══════════════════════════════════════════════════════════
  // ALL clients (including host) listen for execute_playback.
  // The server tells everyone WHEN to trigger the action.
  useEffect(() => {
    if (!socket || !isReady) return;

    const handleExecutePlayback = (data: ExecutePlaybackEvent) => {
      // Cancel any previously scheduled execution
      if (pendingExecutionRef.current) {
        clearTimeout(pendingExecutionRef.current);
        pendingExecutionRef.current = null;
      }

      const serverTimeNow = getCurrentServerTime();
      const waitTime = data.executeAtServerTime - serverTimeNow;

      console.log(
        `[Sync] execute_playback: action=${data.action}, ` +
        `mediaTime=${data.mediaTime.toFixed(2)}s, ` +
        `waitTime=${waitTime.toFixed(0)}ms`
      );

      const executeAction = () => {
        isSyncingRef.current = true;

        if (data.action === "PLAY") {
          // If we're late, adjust mediaTime forward to catch up
          const currentServerTime = getCurrentServerTime();
          const lateness = currentServerTime - data.executeAtServerTime;
          const adjustedTime = lateness > 0
            ? data.mediaTime + lateness / 1000
            : data.mediaTime;

          if (lateness > 0) {
            console.log(
              `[Sync] Late by ${lateness.toFixed(0)}ms, catching up to ${adjustedTime.toFixed(2)}s`
            );
          }

          seekTo(adjustedTime);
          playVideo();
        } else if (data.action === "PAUSE") {
          pauseVideo();
          seekTo(data.mediaTime);
        } else if (data.action === "SEEK") {
          // If we're late and playing, adjust forward
          const currentServerTime = getCurrentServerTime();
          const lateness = currentServerTime - data.executeAtServerTime;
          const adjustedTime = lateness > 0
            ? data.mediaTime + lateness / 1000
            : data.mediaTime;

          seekTo(adjustedTime);
        }

        // Reset sync guard after player has had time to process
        setTimeout(() => {
          isSyncingRef.current = false;
        }, 500);
      };

      if (waitTime > 0) {
        // Schedule execution at the precise future moment
        pendingExecutionRef.current = setTimeout(executeAction, waitTime);
      } else {
        // We're late — execute immediately with catch-up
        executeAction();
      }
    };

    socket.on("execute_playback", handleExecutePlayback);

    return () => {
      socket.off("execute_playback", handleExecutePlayback);
      if (pendingExecutionRef.current) {
        clearTimeout(pendingExecutionRef.current);
      }
    };
  }, [
    socket,
    isReady,
    seekTo,
    playVideo,
    pauseVideo,
    getCurrentServerTime,
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

  // ─── Guest: periodic drift correction with playbackRate squeezing ───
  useEffect(() => {
    if (!socket || isHost || !isReady) return;

    const handleHostState = (data: {
      currentTime: number;
      isPlaying: boolean;
      videoId: string | null;
      serverTime?: number;
    }) => {
      if (!isReady) return;

      let hostTime = data.currentTime;
      // Add latency compensation if playing
      if (data.serverTime && data.isPlaying) {
        const offset = getServerTimeOffset();
        const elapsed = (Date.now() - data.serverTime - offset) / 1000;
        hostTime += Math.max(0, elapsed);
      }

      const localTime = getCurrentTime();
      const drift = localTime - hostTime; // positive = ahead, negative = behind

      // Ensure play/pause state matches
      if (data.isPlaying && playerState !== 1) {
        isSyncingRef.current = true;
        seekTo(hostTime);
        playVideo();
        setTimeout(() => {
          isSyncingRef.current = false;
        }, 500);
        return;
      } else if (!data.isPlaying && playerState === 1) {
        isSyncingRef.current = true;
        pauseVideo();
        seekTo(hostTime);
        setTimeout(() => {
          isSyncingRef.current = false;
        }, 500);
        return;
      }

      const absDrift = Math.abs(drift);

      if (absDrift > 0.3) {
        // Large drift (>300ms): hard seek to correct position
        console.log(
          `[DriftCorrection] Hard seek: drift=${(drift * 1000).toFixed(0)}ms`
        );
        isSyncingRef.current = true;
        seekTo(hostTime);
        setPlaybackRate(1.0);
        setTimeout(() => {
          isSyncingRef.current = false;
        }, 500);
      } else if (absDrift > 0.05) {
        // Minor drift (50-300ms): use playbackRate squeezing
        const adjustedRate = drift > 0 ? 0.98 : 1.02; // slow down if ahead, speed up if behind
        console.log(
          `[DriftCorrection] PlaybackRate squeeze: drift=${(drift * 1000).toFixed(0)}ms, rate=${adjustedRate}`
        );
        setPlaybackRate(adjustedRate);
      } else {
        // Drift within acceptable range (<50ms): reset to normal speed
        setPlaybackRate(1.0);
      }
    };

    socket.on("host_state", handleHostState);

    // Request sync every 3 seconds
    const interval = setInterval(() => {
      socket.emit("request_sync");
    }, 3000);

    return () => {
      socket.off("host_state", handleHostState);
      clearInterval(interval);
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
    getServerTimeOffset,
    setPlaybackRate,
  ]);

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
