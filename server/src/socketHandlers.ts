// ─── Socket Event Handlers ────────────────────────────────────
// All Socket.io event handlers, wired up in a single function.
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

export function registerSocketHandlers(io: Server): void {
  io.on("connection", (socket: Socket) => {
    console.log(`[Socket] Connected: ${socket.id}`);

    // ─── Clock Synchronization ───────────────────────────────
    socket.on("ping_sync", (data: { clientTime: number }, callback) => {
      callback({ serverTime: Date.now() });
    });

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

    // ─── Sync Action (Host only) ────────────────────────────
    // The core sync mechanism: host broadcasts PLAY/PAUSE/SEEK
    socket.on(
      "sync_action",
      (data: {
        action: "PLAY" | "PAUSE" | "SEEK";
        currentTime: number;
      }) => {
        const room = findRoomBySocket(socket.id);
        if (!room || room.hostId !== socket.id) return;

        // Update server-side state
        updatePlaybackState(
          room.id,
          data.currentTime,
          data.action === "PLAY" || data.action === "SEEK"
        );

        // Broadcast to all OTHER clients in the room (not back to host)
        socket.to(room.id).emit("sync_action", {
          action: data.action,
          currentTime: data.currentTime,
          serverTime: Date.now(),
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
    // Host responds with their current state
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

        // Send directly to the requesting guest
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
