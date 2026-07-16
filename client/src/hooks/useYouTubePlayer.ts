"use client";

// ─── YouTube Player Hook ──────────────────────────────────────
// Manages the YouTube Iframe Player API lifecycle in React.

import { useEffect, useRef, useState, useCallback } from "react";

// Extend Window to include YouTube API globals
declare global {
  interface Window {
    YT: {
      Player: typeof YT.Player;
      PlayerState: typeof YT.PlayerState;
    };
    onYouTubeIframeAPIReady: () => void;
  }
}

interface UseYouTubePlayerOptions {
  containerId: string;
  onStateChange?: (state: number, currentTime: number) => void;
  onReady?: () => void;
}

interface UseYouTubePlayerReturn {
  player: YT.Player | null;
  isReady: boolean;
  playerState: number;
  currentTime: number;
  duration: number;
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number) => void;
  loadVideo: (videoId: string) => void;
  getCurrentTime: () => number;
  setPlaybackRate: (rate: number) => void;
}

// Track if the API script is already loading/loaded globally
let isAPILoading = false;
let isAPIReady = false;
const readyCallbacks: (() => void)[] = [];

function loadYouTubeAPI(): Promise<void> {
  return new Promise((resolve) => {
    if (isAPIReady && window.YT && window.YT.Player) {
      resolve();
      return;
    }

    readyCallbacks.push(resolve);

    if (isAPILoading) return;
    isAPILoading = true;

    // Set up the global callback
    window.onYouTubeIframeAPIReady = () => {
      isAPIReady = true;
      readyCallbacks.forEach((cb) => cb());
      readyCallbacks.length = 0;
    };

    // Inject the script
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    tag.async = true;
    const firstScript = document.getElementsByTagName("script")[0];
    firstScript?.parentNode?.insertBefore(tag, firstScript);
  });
}

export function useYouTubePlayer({
  containerId,
  onStateChange,
  onReady,
}: UseYouTubePlayerOptions): UseYouTubePlayerReturn {
  const playerRef = useRef<YT.Player | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [playerState, setPlayerState] = useState(-1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const onStateChangeRef = useRef(onStateChange);
  const onReadyRef = useRef(onReady);
  onStateChangeRef.current = onStateChange;
  onReadyRef.current = onReady;

  // Initialize player
  useEffect(() => {
    let destroyed = false;

    async function init() {
      await loadYouTubeAPI();
      if (destroyed) return;

      // Check if container exists
      const container = document.getElementById(containerId);
      if (!container) return;

      playerRef.current = new window.YT.Player(containerId, {
        height: "100%",
        width: "100%",
        playerVars: {
          autoplay: 0,
          controls: 0, // We provide our own controls
          modestbranding: 1,
          rel: 0,
          fs: 0,
          iv_load_policy: 3, // No annotations
          disablekb: 1,
          playsinline: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: () => {
            if (destroyed) return;
            setIsReady(true);
            setDuration(playerRef.current?.getDuration() || 0);
            onReadyRef.current?.();
          },
          onStateChange: (event: YT.OnStateChangeEvent) => {
            if (destroyed) return;
            const state = event.data;
            setPlayerState(state);

            const time = playerRef.current?.getCurrentTime() || 0;
            setCurrentTime(time);

            if (state === window.YT.PlayerState.PLAYING) {
              setDuration(playerRef.current?.getDuration() || 0);
            }

            onStateChangeRef.current?.(state, time);
          },
        },
      });
    }

    init();

    return () => {
      destroyed = true;
      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch {
          // Player might already be destroyed
        }
        playerRef.current = null;
      }
    };
  }, [containerId]);

  // Poll current time while playing
  useEffect(() => {
    if (playerState !== 1) return; // Only poll when PLAYING

    const interval = setInterval(() => {
      if (playerRef.current) {
        try {
          setCurrentTime(playerRef.current.getCurrentTime());
        } catch {
          // Ignore errors from destroyed player
        }
      }
    }, 500);

    return () => clearInterval(interval);
  }, [playerState]);

  // ─── Exposed Methods ──────────────────────────────────────

  const playVideo = useCallback(() => {
    playerRef.current?.playVideo();
  }, []);

  const pauseVideo = useCallback(() => {
    playerRef.current?.pauseVideo();
  }, []);

  const seekTo = useCallback((seconds: number) => {
    playerRef.current?.seekTo(seconds, true);
  }, []);

  const loadVideo = useCallback((videoId: string) => {
    if (playerRef.current) {
      playerRef.current.loadVideoById(videoId);
      setCurrentTime(0);
    }
  }, []);

  const getCurrentTime = useCallback((): number => {
    try {
      return playerRef.current?.getCurrentTime() || 0;
    } catch {
      return 0;
    }
  }, []);

  const setPlaybackRate = useCallback((rate: number) => {
    try {
      playerRef.current?.setPlaybackRate(rate);
    } catch {
      // Ignore errors from destroyed player
    }
  }, []);

  return {
    player: playerRef.current,
    isReady,
    playerState,
    currentTime,
    duration,
    playVideo,
    pauseVideo,
    seekTo,
    loadVideo,
    getCurrentTime,
    setPlaybackRate,
  };
}
