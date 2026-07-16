// ─── Socket Event Handlers ────────────────────────────────────
// All Socket.io event handlers, wired up in a single function.
// Implements BeatSync-grade coordinated execution for perfect sync.
// Includes session recovery support for graceful page refreshes.

import { Server, Socket } from "socket.io";
import {
  createRoom,
  joinRoom,
  leaveRoom,
  getRoom,
  findRoomBySocket,
  roomToSnapshot,
  updatePlaybackState,
  changeTrack,
  addToQueue,
  popFromQueue,
  markDisconnected,
  rejoinRoom,
} from "./roomManager";

// ─── RTT Tracking ────────────────────────────────────────────
// Per-socket RTT measurements for adaptive buffer calculation
const socketRTTs = new Map<string, number>();

const MIN_BUFFER_MS = 150;
const MAX_BUFFER_MS = 500;
const DEFAULT_BUFFER_MS = 250;

/**
 * Calculate the optimal execution buffer for a room based on
 * the maximum RTT of all connected clients.
 */
function getRoomBuffer(roomId: string): number {
  const room = getRoom(roomId);
  if (!room) return DEFAULT_BUFFER_MS;

  let maxRTT = 0;
  for (const [socketId] of room.guests) {
    const rtt = socketRTTs.get(socketId);
    if (rtt && rtt > maxRTT) {
      maxRTT = rtt;
    }
  }

  // Buffer = maxRTT + 50ms headroom, clamped to [MIN, MAX]
  const buffer = Math.min(MAX_BUFFER_MS, Math.max(MIN_BUFFER_MS, maxRTT + 50));
  return buffer;
}

export function registerSocketHandlers(io: Server): void {
  io.on("connection", (socket: Socket) => {
    console.log(`[Socket] Connected: ${socket.id}`);

    // ─── Clock Synchronization (NTP-like) ────────────────────
    // Client sends clientTime, we respond with serverTime.
    // Client also reports its measured RTT so we can track room-wide latency.
    socket.on(
      "ping_sync",
      (
        data: { clientTime: number; rtt?: number },
        callback: (response: { serverTime: number }) => void
      ) => {
        // Store client-reported RTT if provided
        if (data.rtt !== undefined && data.rtt > 0) {
          socketRTTs.set(socket.id, data.rtt);
        }

        callback({ serverTime: Date.now() });
      }
    );

    // ─── Create Room ─────────────────────────────────────────
    socket.on(
      "create_room",
      (
        data: { hostName: string; sessionId: string },
        callback: (response: {
          success: boolean;
          roomId?: string;
          room?: any;
          error?: string;
        }) => void
      ) => {
        try {
          const room = createRoom(
            socket.id,
            data.hostName || "Host",
            data.sessionId
          );
          socket.join(room.id);

          callback({
            success: true,
            roomId: room.id,
            room: roomToSnapshot(room),
          });
        } catch (err) {
          console.error("[Socket] create_room error:", err);
          callback({ success: false, error: "Failed to create room" });
        }
      }
    );

    // ─── Join Room ───────────────────────────────────────────
    socket.on(
      "join_room",
      (
        data: { roomId: string; guestName: string; sessionId: string },
        callback: (response: {
          success: boolean;
          room?: any;
          error?: string;
        }) => void
      ) => {
        try {
          const room = joinRoom(
            data.roomId,
            socket.id,
            data.guestName || "Guest",
            data.sessionId
          );

          if (!room) {
            callback({ success: false, error: "Room not found" });
            return;
          }

          socket.join(room.id);

          const snapshot = roomToSnapshot(room);

          // Send full state to the joining guest
          callback({ success: true, room: snapshot });

          // Notify existing participants
          socket.to(room.id).emit("guest_list_update", {
            guests: snapshot.guests,
          });

          socket.to(room.id).emit("user_joined", {
            displayName: data.guestName,
            socketId: socket.id,
          });
        } catch (err) {
          console.error("[Socket] join_room error:", err);
          callback({ success: false, error: "Failed to join room" });
        }
      }
    );

    // ─── Rejoin Room (Session Recovery) ──────────────────────
    socket.on(
      "rejoin_room",
      (
        data: { sessionId: string; roomId: string },
        callback: (response: {
          success: boolean;
          room?: any;
          isHost?: boolean;
          error?: string;
        }) => void
      ) => {
        try {
          const result = rejoinRoom(data.sessionId, socket.id, data.roomId);

          if (!result) {
            callback({
              success: false,
              error: "Room not found or session expired",
            });
            return;
          }

          const { room, isHost } = result;

          // Join the Socket.io room
          socket.join(room.id);

          const snapshot = roomToSnapshot(room);

          // Send full state back to the reconnecting user
          callback({
            success: true,
            room: snapshot,
            isHost,
          });

          // Notify other participants that someone reconnected
          socket.to(room.id).emit("guest_list_update", {
            guests: snapshot.guests,
          });

          console.log(
            `[Socket] Session ${data.sessionId} rejoined room ${room.id} via socket ${socket.id}`
          );
        } catch (err) {
          console.error("[Socket] rejoin_room error:", err);
          callback({
            success: false,
            error: "Failed to rejoin room",
          });
        }
      }
    );

    // ─── Track Changed (Host only) ──────────────────────────
    socket.on(
      "track_changed",
      (data: { videoId: string; title: string }) => {
        const room = findRoomBySocket(socket.id);
        if (!room || room.hostId !== socket.id) return;

        changeTrack(room.id, data.videoId, data.title);

        // Broadcast to entire room including host for confirmation
        io.to(room.id).emit("track_changed", {
          videoId: data.videoId,
          title: data.title,
        });
      }
    );

    // ═══════════════════════════════════════════════════════════
    // ─── COORDINATED EXECUTION: Intent → Execute ─────────────
    // ═══════════════════════════════════════════════════════════
    //
    // Instead of immediately broadcasting sync events, the host
    // sends an "intent" and the server schedules a coordinated
    // execution moment in the future so all clients (including
    // the host) execute simultaneously.

    // ─── Intent Play (Host only) ─────────────────────────────
    socket.on(
      "intent_play",
      (data: { mediaTime: number }) => {
        const room = findRoomBySocket(socket.id);
        if (!room || room.hostId !== socket.id) return;

        const buffer = getRoomBuffer(room.id);
        const executeAtServerTime = Date.now() + buffer;

        // Update server-side state
        updatePlaybackState(room.id, data.mediaTime, true);

        console.log(
          `[Sync] intent_play in room ${room.id}: mediaTime=${data.mediaTime.toFixed(2)}s, buffer=${buffer}ms, executeAt=${executeAtServerTime}`
        );

        // Broadcast to ALL clients in the room (including host)
        io.to(room.id).emit("execute_playback", {
          action: "PLAY",
          mediaTime: data.mediaTime,
          executeAtServerTime,
        });
      }
    );

    // ─── Intent Pause (Host only) ────────────────────────────
    socket.on(
      "intent_pause",
      (data: { mediaTime: number }) => {
        const room = findRoomBySocket(socket.id);
        if (!room || room.hostId !== socket.id) return;

        const buffer = getRoomBuffer(room.id);
        const executeAtServerTime = Date.now() + buffer;

        // Update server-side state
        updatePlaybackState(room.id, data.mediaTime, false);

        console.log(
          `[Sync] intent_pause in room ${room.id}: mediaTime=${data.mediaTime.toFixed(2)}s, buffer=${buffer}ms`
        );

        // Broadcast to ALL clients (including host)
        io.to(room.id).emit("execute_playback", {
          action: "PAUSE",
          mediaTime: data.mediaTime,
          executeAtServerTime,
        });
      }
    );

    // ─── Intent Seek (Host only) ─────────────────────────────
    socket.on(
      "intent_seek",
      (data: { mediaTime: number }) => {
        const room = findRoomBySocket(socket.id);
        if (!room || room.hostId !== socket.id) return;

        const buffer = getRoomBuffer(room.id);
        const executeAtServerTime = Date.now() + buffer;

        // Update server-side state
        updatePlaybackState(room.id, data.mediaTime, room.isPlaying);

        console.log(
          `[Sync] intent_seek in room ${room.id}: mediaTime=${data.mediaTime.toFixed(2)}s, buffer=${buffer}ms`
        );

        // Broadcast to ALL clients (including host)
        io.to(room.id).emit("execute_playback", {
          action: "SEEK",
          mediaTime: data.mediaTime,
          executeAtServerTime,
        });
      }
    );

    // ─── Request Sync (Guest → Server → Host → Server → Guest) ─
    // Guest asks "where is the host right now?"
    socket.on("request_sync", () => {
      const room = findRoomBySocket(socket.id);
      if (!room) return;

      // Ask the host for their current timestamp
      io.to(room.hostId).emit("request_sync", {
        requesterId: socket.id,
      });
    });

    // ─── Host State Response ─────────────────────────────────
    // Host responds with their current state (for periodic drift correction)
    socket.on(
      "host_state",
      (data: {
        requesterId: string;
        currentTime: number;
        isPlaying: boolean;
        videoId: string | null;
      }) => {
        const room = findRoomBySocket(socket.id);
        if (!room || room.hostId !== socket.id) return;

        // Update server state
        updatePlaybackState(room.id, data.currentTime, data.isPlaying);

        // Send directly to the requesting guest with server timestamp
        io.to(data.requesterId).emit("host_state", {
          currentTime: data.currentTime,
          isPlaying: data.isPlaying,
          videoId: data.videoId,
          serverTime: Date.now(),
        });
      }
    );

    // ─── Queue: Add Track ────────────────────────────────────
    socket.on(
      "queue_add",
      (
        data: { videoId: string; title: string },
        callback?: (response: {
          success: boolean;
          error?: string;
        }) => void
      ) => {
        const room = findRoomBySocket(socket.id);
        if (!room) {
          callback?.({ success: false, error: "Not in a room" });
          return;
        }

        const guest = room.guests.get(socket.id);
        const addedBy = guest?.displayName || "Unknown";
        const item = addToQueue(room.id, data.videoId, data.title, addedBy);

        if (!item) {
          callback?.({ success: false, error: "Failed to add to queue" });
          return;
        }

        callback?.({ success: true });

        // Broadcast updated queue to entire room
        const snapshot = roomToSnapshot(room);
        io.to(room.id).emit("queue_update", { queue: snapshot.queue });
      }
    );

    // ─── Queue: Play Next (Host only) ────────────────────────
    socket.on("play_next", () => {
      const room = findRoomBySocket(socket.id);
      if (!room || room.hostId !== socket.id) return;

      const nextTrack = popFromQueue(room.id);
      if (!nextTrack) return;

      // Change the track
      changeTrack(room.id, nextTrack.videoId, nextTrack.title);

      // Broadcast track change and updated queue
      io.to(room.id).emit("track_changed", {
        videoId: nextTrack.videoId,
        title: nextTrack.title,
      });

      const snapshot = roomToSnapshot(room);
      io.to(room.id).emit("queue_update", { queue: snapshot.queue });
    });

    // ─── Disconnect (Graceful with Grace Period) ─────────────
    socket.on("disconnect", () => {
      console.log(`[Socket] Disconnected: ${socket.id}`);

      // Clean up RTT tracking
      socketRTTs.delete(socket.id);

      // Use grace period instead of immediate removal
      const result = markDisconnected(socket.id);
      if (!result) return;

      const { roomId } = result;
      const room = getRoom(roomId);
      if (!room) return;

      // Update guest list for remaining participants (user disappears temporarily)
      const snapshot = roomToSnapshot(room);
      io.to(room.id).emit("guest_list_update", {
        guests: snapshot.guests,
      });

      // Note: We do NOT emit host_changed here. The grace period timer
      // in roomManager handles host promotion if the timer expires.
      // If the user reconnects within 15s, they get their host status back.
    });
  });
}
