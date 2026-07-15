"use client";

// ─── Socket Context ───────────────────────────────────────────
// Centralized Socket.io connection provider with session recovery.
// Stores sessionId + room info in sessionStorage to survive page refreshes.

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
} from "react";
import { io, Socket } from "socket.io-client";

// ─── Types ───────────────────────────────────────────────────

export interface QueueItem {
  id: string;
  videoId: string;
  title: string;
  addedBy: string;
}

export interface GuestInfo {
  socketId: string;
  displayName: string;
}

export interface RoomState {
  id: string;
  hostId: string;
  hostName: string;
  currentVideoId: string | null;
  currentVideoTitle: string | null;
  currentTime: number;
  isPlaying: boolean;
  queue: QueueItem[];
  guests: GuestInfo[];
}

interface SocketContextType {
  socket: Socket | null;
  isConnected: boolean;
  roomState: RoomState | null;
  isHost: boolean;
  sessionId: string;
  getServerTimeOffset: () => number;
  createRoom: (hostName: string) => Promise<string>;
  joinRoom: (roomId: string, guestName: string) => Promise<boolean>;
  emitSyncAction: (
    action: "PLAY" | "PAUSE" | "SEEK",
    currentTime: number
  ) => void;
  emitTrackChanged: (videoId: string, title: string) => void;
  emitQueueAdd: (videoId: string, title: string) => Promise<boolean>;
  emitPlayNext: () => void;
  emitHostState: (
    requesterId: string,
    currentTime: number,
    isPlaying: boolean,
    videoId: string | null
  ) => void;
}

const SocketContext = createContext<SocketContextType | null>(null);

// ─── Server URL ──────────────────────────────────────────────
// Use window.location.hostname to ensure it works when accessed from other devices on the local network.
const getSocketUrl = () => {
  if (process.env.NEXT_PUBLIC_SOCKET_URL)
    return process.env.NEXT_PUBLIC_SOCKET_URL;
  if (typeof window !== "undefined") {
    return `http://${window.location.hostname}:3000`;
  }
  return "http://localhost:3000";
};

// ─── Session Storage Helpers ─────────────────────────────────

const SESSION_KEY = "musicroom_session";

interface StoredSession {
  sessionId: string;
  roomId: string;
  displayName: string;
  isHost: boolean;
}

function getStoredSession(): StoredSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredSession;
  } catch {
    return null;
  }
}

function saveSession(data: StoredSession): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
}

function clearSession(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(SESSION_KEY);
}

function getOrCreateSessionId(): string {
  if (typeof window === "undefined") return crypto.randomUUID();
  const stored = getStoredSession();
  if (stored?.sessionId) return stored.sessionId;
  return crypto.randomUUID();
}

// ─── Provider ────────────────────────────────────────────────

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [isHost, setIsHost] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  // Stable sessionId — generated once, reused across reconnections
  const sessionIdRef = useRef<string>(getOrCreateSessionId());
  const sessionId = sessionIdRef.current;

  // Track whether we've already attempted a rejoin (to prevent loops)
  const rejoinAttemptedRef = useRef(false);

  // ─── Clock Synchronization ───────────────────────────────
  const clockOffsetsRef = useRef<number[]>([]);
  
  const getServerTimeOffset = useCallback(() => {
    const offsets = clockOffsetsRef.current;
    if (offsets.length === 0) return 0;
    // Return average offset
    return offsets.reduce((a, b) => a + b, 0) / offsets.length;
  }, []);

  // Initialize socket connection
  useEffect(() => {
    const url = getSocketUrl();
    const newSocket = io(url, {
      transports: ["polling", "websocket"],
      autoConnect: true,
    });

    newSocket.on("connect", () => {
      console.log("[Socket] Connected:", newSocket.id);
      setIsConnected(true);

      // ─── Auto-rejoin on reconnect ─────────────────────────
      // If we have saved session info, try to rejoin the room
      const stored = getStoredSession();
      if (stored && stored.sessionId === sessionId && !rejoinAttemptedRef.current) {
        rejoinAttemptedRef.current = true;
        console.log(
          `[Socket] Attempting auto-rejoin: room=${stored.roomId}, session=${stored.sessionId}`
        );

        newSocket.emit(
          "rejoin_room",
          { sessionId: stored.sessionId, roomId: stored.roomId },
          (response: {
            success: boolean;
            room?: RoomState;
            isHost?: boolean;
            error?: string;
          }) => {
            if (response.success && response.room) {
              console.log("[Socket] Auto-rejoin successful!");
              setRoomState(response.room);
              setIsHost(response.isHost ?? false);
            } else {
              console.log(
                "[Socket] Auto-rejoin failed:",
                response.error
              );
              clearSession();
            }
            // Allow future rejoin attempts (e.g. if socket disconnects and reconnects again)
            rejoinAttemptedRef.current = false;
          }
        );
      } else {
        // Reset for next reconnect cycle
        rejoinAttemptedRef.current = false;
      }
    });

    let pingInterval: NodeJS.Timeout;

    const measureClockOffset = () => {
      const clientTime = Date.now();
      newSocket.emit("ping_sync", { clientTime }, (response: { serverTime: number }) => {
        const now = Date.now();
        const rtt = now - clientTime;
        const offset = response.serverTime - (clientTime + rtt / 2);
        
        clockOffsetsRef.current.push(offset);
        if (clockOffsetsRef.current.length > 5) {
          clockOffsetsRef.current.shift();
        }
      });
    };

    newSocket.on("connect", () => {
      measureClockOffset();
      pingInterval = setInterval(measureClockOffset, 10000);
    });

    newSocket.on("disconnect", () => {
      console.log("[Socket] Disconnected");
      setIsConnected(false);
    });

    // ─── Room Events ───────────────────────────────────────
    newSocket.on("guest_list_update", (data: { guests: GuestInfo[] }) => {
      setRoomState((prev) =>
        prev ? { ...prev, guests: data.guests } : null
      );
    });

    newSocket.on(
      "track_changed",
      (data: { videoId: string; title: string }) => {
        setRoomState((prev) =>
          prev
            ? {
                ...prev,
                currentVideoId: data.videoId,
                currentVideoTitle: data.title,
                currentTime: 0,
                isPlaying: true,
              }
            : null
        );
      }
    );

    newSocket.on("queue_update", (data: { queue: QueueItem[] }) => {
      setRoomState((prev) =>
        prev ? { ...prev, queue: data.queue } : null
      );
    });

    newSocket.on(
      "host_changed",
      (data: { newHostId: string; hostName: string }) => {
        setRoomState((prev) =>
          prev
            ? {
                ...prev,
                hostId: data.newHostId,
                hostName: data.hostName,
              }
            : null
        );
        // Check if we are the new host
        if (data.newHostId === newSocket.id) {
          setIsHost(true);
        }
      }
    );

    socketRef.current = newSocket;
    setSocket(newSocket);

    return () => {
      clearInterval(pingInterval);
      newSocket.removeAllListeners();
      newSocket.disconnect();
    };
  }, [sessionId]);

  // ─── Actions ───────────────────────────────────────────────

  const createRoom = useCallback(
    async (hostName: string): Promise<string> => {
      return new Promise((resolve, reject) => {
        if (!socketRef.current) {
          reject(new Error("Socket not connected"));
          return;
        }
        socketRef.current.emit(
          "create_room",
          { hostName, sessionId },
          (response: {
            success: boolean;
            roomId?: string;
            room?: RoomState;
            error?: string;
          }) => {
            if (response.success && response.room && response.roomId) {
              setRoomState(response.room);
              setIsHost(true);

              // Save to sessionStorage for recovery
              saveSession({
                sessionId,
                roomId: response.roomId,
                displayName: hostName,
                isHost: true,
              });

              resolve(response.roomId);
            } else {
              reject(new Error(response.error || "Failed to create room"));
            }
          }
        );
      });
    },
    [sessionId]
  );

  const joinRoom = useCallback(
    async (roomId: string, guestName: string): Promise<boolean> => {
      return new Promise((resolve, reject) => {
        if (!socketRef.current) {
          reject(new Error("Socket not connected"));
          return;
        }
        socketRef.current.emit(
          "join_room",
          { roomId, guestName, sessionId },
          (response: {
            success: boolean;
            room?: RoomState;
            error?: string;
          }) => {
            if (response.success && response.room) {
              setRoomState(response.room);
              setIsHost(false);

              // Save to sessionStorage for recovery
              saveSession({
                sessionId,
                roomId,
                displayName: guestName,
                isHost: false,
              });

              resolve(true);
            } else {
              reject(new Error(response.error || "Failed to join room"));
            }
          }
        );
      });
    },
    [sessionId]
  );

  const emitSyncAction = useCallback(
    (action: "PLAY" | "PAUSE" | "SEEK", currentTime: number) => {
      socketRef.current?.emit("sync_action", { action, currentTime });

      // Update local state too
      setRoomState((prev) =>
        prev
          ? {
              ...prev,
              currentTime,
              isPlaying: action !== "PAUSE",
            }
          : null
      );
    },
    []
  );

  const emitTrackChanged = useCallback(
    (videoId: string, title: string) => {
      socketRef.current?.emit("track_changed", { videoId, title });
    },
    []
  );

  const emitQueueAdd = useCallback(
    async (videoId: string, title: string): Promise<boolean> => {
      return new Promise((resolve) => {
        socketRef.current?.emit(
          "queue_add",
          { videoId, title },
          (response: { success: boolean }) => {
            resolve(response.success);
          }
        );
      });
    },
    []
  );

  const emitPlayNext = useCallback(() => {
    socketRef.current?.emit("play_next");
  }, []);

  const emitHostState = useCallback(
    (
      requesterId: string,
      currentTime: number,
      isPlaying: boolean,
      videoId: string | null
    ) => {
      socketRef.current?.emit("host_state", {
        requesterId,
        currentTime,
        isPlaying,
        videoId,
      });
    },
    []
  );

  return (
    <SocketContext.Provider
      value={{
        socket,
        isConnected,
        roomState,
        isHost,
        sessionId,
        getServerTimeOffset,
        createRoom,
        joinRoom,
        emitSyncAction,
        emitTrackChanged,
        emitQueueAdd,
        emitPlayNext,
        emitHostState,
      }}
    >
      {children}
    </SocketContext.Provider>
  );
}

// ─── Hook ────────────────────────────────────────────────────

export function useSocketContext(): SocketContextType {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error("useSocketContext must be used within a SocketProvider");
  }
  return context;
}
