// ─── Socket Event Handlers ────────────────────────────────────
// All Socket.io event handlers, wired up in a single function.

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
} from "./roomManager";

export function registerSocketHandlers(io: Server): void {
  io.on("connection", (socket: Socket) => {
    console.log(`[Socket] Connected: ${socket.id}`);

    // ─── Create Room ─────────────────────────────────────────
    socket.on(
      "create_room",
      (
        data: { hostName: string },
        callback: (response: { success: boolean; roomId?: string; room?: any; error?: string }) => void
      ) => {
        try {
          const room = createRoom(socket.id, data.hostName || "Host");
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
        data: { roomId: string; guestName: string },
        callback: (response: { success: boolean; room?: any; error?: string }) => void
      ) => {
        try {
          const room = joinRoom(
            data.roomId,
            socket.id,
            data.guestName || "Guest"
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
        });
      }
    );

    // ─── Queue: Add Track ────────────────────────────────────
    socket.on(
      "queue_add",
      (
        data: { videoId: string; title: string },
        callback?: (response: { success: boolean; error?: string }) => void
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

    // ─── Disconnect ──────────────────────────────────────────
    socket.on("disconnect", () => {
      console.log(`[Socket] Disconnected: ${socket.id}`);

      const result = leaveRoom(socket.id);
      if (!result) return;

      const { room, wasHost, newHostId, isEmpty } = result;

      if (isEmpty) return; // Room already deleted

      const snapshot = roomToSnapshot(room);

      // Notify remaining participants of updated guest list
      io.to(room.id).emit("guest_list_update", {
        guests: snapshot.guests,
      });

      io.to(room.id).emit("user_left", {
        socketId: socket.id,
      });

      // If host departed, notify the new host
      if (wasHost && newHostId) {
        io.to(room.id).emit("host_changed", {
          newHostId: newHostId,
          hostName: room.hostName,
        });
      }
    });
  });
}
