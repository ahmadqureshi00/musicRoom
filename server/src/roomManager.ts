// ─── Room Manager ─────────────────────────────────────────────
// In-memory room state management with session recovery support.

import { v4 as uuidv4 } from "uuid";

// ─── Types ───────────────────────────────────────────────────

export interface QueueItem {
  id: string;
  videoId: string;
  title: string;
  addedBy: string;
}

export interface Guest {
  socketId: string;
  sessionId: string;
  displayName: string;
}

export interface Room {
  id: string;
  hostId: string;
  hostSessionId: string;
  hostName: string;
  currentVideoId: string | null;
  currentVideoTitle: string | null;
  currentTime: number;
  isPlaying: boolean;
  queue: QueueItem[];
  guests: Map<string, Guest>; // socketId → Guest
  createdAt: Date;
}

export interface RoomSnapshot {
  id: string;
  hostId: string;
  hostName: string;
  currentVideoId: string | null;
  currentVideoTitle: string | null;
  currentTime: number;
  isPlaying: boolean;
  queue: QueueItem[];
  guests: { socketId: string; displayName: string }[];
}

// ─── Room Store ──────────────────────────────────────────────

const rooms = new Map<string, Room>();

// ─── Session Recovery Maps ───────────────────────────────────
// sessionId → { roomId, displayName, wasHost }
interface PendingDisconnect {
  roomId: string;
  sessionId: string;
  displayName: string;
  wasHost: boolean;
  timer: NodeJS.Timeout;
}

const pendingDisconnects = new Map<string, PendingDisconnect>();

// sessionId → socketId (for active connections)
const sessionToSocket = new Map<string, string>();

const GRACE_PERIOD_MS = 15_000; // 15 seconds

/**
 * Generate a short, human-friendly room code (6 uppercase alphanumeric chars).
 */
function generateRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // No ambiguous chars (0/O, 1/I/L)
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  // Ensure uniqueness
  if (rooms.has(code)) return generateRoomCode();
  return code;
}

/**
 * Create a new room and register the host.
 */
export function createRoom(
  hostSocketId: string,
  hostName: string,
  sessionId: string
): Room {
  const roomId = generateRoomCode();
  const room: Room = {
    id: roomId,
    hostId: hostSocketId,
    hostSessionId: sessionId,
    hostName: hostName,
    currentVideoId: null,
    currentVideoTitle: null,
    currentTime: 0,
    isPlaying: false,
    queue: [],
    guests: new Map(),
    createdAt: new Date(),
  };

  // Add host as first "guest" entry too so they appear in the list
  room.guests.set(hostSocketId, {
    socketId: hostSocketId,
    sessionId: sessionId,
    displayName: hostName,
  });

  // Track session → socket mapping
  sessionToSocket.set(sessionId, hostSocketId);

  rooms.set(roomId, room);
  console.log(
    `[Room] Created room ${roomId} by ${hostName} (socket=${hostSocketId}, session=${sessionId})`
  );
  return room;
}

/**
 * Add a guest to an existing room.
 * Returns the room or null if not found.
 */
export function joinRoom(
  roomId: string,
  guestSocketId: string,
  guestName: string,
  sessionId: string
): Room | null {
  const room = rooms.get(roomId.toUpperCase());
  if (!room) return null;

  room.guests.set(guestSocketId, {
    socketId: guestSocketId,
    sessionId: sessionId,
    displayName: guestName,
  });

  // Track session → socket mapping
  sessionToSocket.set(sessionId, guestSocketId);

  console.log(
    `[Room] ${guestName} (socket=${guestSocketId}, session=${sessionId}) joined room ${room.id}`
  );
  return room;
}

// ─── Session Recovery ────────────────────────────────────────

/**
 * Mark a socket as disconnected with a grace period.
 * Instead of immediately removing from the room, start a timer.
 * Returns the room info for the disconnect, or null if socket wasn't in a room.
 */
export function markDisconnected(
  socketId: string
): { roomId: string; sessionId: string; wasHost: boolean } | null {
  // Find which room this socket is in
  for (const [, room] of rooms) {
    const guest = room.guests.get(socketId);
    if (!guest) continue;

    const wasHost = room.hostId === socketId;
    const { sessionId, displayName } = guest;

    console.log(
      `[Room] ${displayName} disconnected from room ${room.id} — starting ${GRACE_PERIOD_MS / 1000}s grace period (session=${sessionId})`
    );

    // Remove from room's guest map (so they don't appear in the list)
    room.guests.delete(socketId);
    sessionToSocket.delete(sessionId);

    // If room is now empty and there's no pending reconnect, start the timer
    const timer = setTimeout(() => {
      pendingDisconnects.delete(sessionId);
      console.log(
        `[Room] Grace period expired for ${displayName} (session=${sessionId})`
      );

      // Check if room still exists
      const currentRoom = rooms.get(room.id);
      if (!currentRoom) return;

      // If the room is empty, delete it
      if (currentRoom.guests.size === 0) {
        rooms.delete(currentRoom.id);
        console.log(`[Room] Room ${currentRoom.id} deleted (empty after grace period)`);
        return;
      }

      // If this was the host, promote a new host
      if (wasHost && currentRoom.hostId === socketId) {
        const firstGuest = currentRoom.guests.values().next().value;
        if (firstGuest) {
          currentRoom.hostId = firstGuest.socketId;
          currentRoom.hostSessionId = firstGuest.sessionId;
          currentRoom.hostName = firstGuest.displayName;
          console.log(
            `[Room] Host promoted in room ${currentRoom.id}: ${firstGuest.displayName}`
          );
          // Return the new host info so socketHandlers can broadcast
          // (handled via the onGracePeriodExpire callback instead)
        }
      }
    }, GRACE_PERIOD_MS);

    pendingDisconnects.set(sessionId, {
      roomId: room.id,
      sessionId,
      displayName,
      wasHost,
      timer,
    });

    return { roomId: room.id, sessionId, wasHost };
  }

  return null;
}

/**
 * Attempt to rejoin a room using a sessionId.
 * Cancels any pending disconnect timer and restores the user.
 */
export function rejoinRoom(
  sessionId: string,
  newSocketId: string,
  roomId: string
): { room: Room; isHost: boolean } | null {
  const room = rooms.get(roomId.toUpperCase());
  if (!room) {
    console.log(`[Room] Rejoin failed: room ${roomId} not found`);
    return null;
  }

  // Cancel pending disconnect timer if exists
  const pending = pendingDisconnects.get(sessionId);
  if (pending) {
    clearTimeout(pending.timer);
    pendingDisconnects.delete(sessionId);
    console.log(
      `[Room] Cancelled grace period for ${pending.displayName} (session=${sessionId})`
    );

    // Re-add to room with new socket ID
    room.guests.set(newSocketId, {
      socketId: newSocketId,
      sessionId: sessionId,
      displayName: pending.displayName,
    });

    // Restore host status if they were the host
    const isHost = pending.wasHost;
    if (isHost) {
      room.hostId = newSocketId;
      room.hostSessionId = sessionId;
      room.hostName = pending.displayName;
    }

    // Update session → socket mapping
    sessionToSocket.set(sessionId, newSocketId);

    console.log(
      `[Room] ${pending.displayName} rejoined room ${room.id} (new socket=${newSocketId}, isHost=${isHost})`
    );

    return { room, isHost };
  }

  // No pending disconnect — maybe they're trying to rejoin a room they're
  // already in (e.g. socket reconnected before disconnect was processed)
  // Check if sessionId is already in the room
  for (const [existingSocketId, guest] of room.guests) {
    if (guest.sessionId === sessionId) {
      // Already in room, just update the socket ID
      if (existingSocketId !== newSocketId) {
        room.guests.delete(existingSocketId);
        room.guests.set(newSocketId, {
          ...guest,
          socketId: newSocketId,
        });

        if (room.hostId === existingSocketId) {
          room.hostId = newSocketId;
        }

        sessionToSocket.set(sessionId, newSocketId);
      }

      const isHost = room.hostId === newSocketId;
      console.log(
        `[Room] ${guest.displayName} re-attached to room ${room.id} (socket=${newSocketId}, isHost=${isHost})`
      );
      return { room, isHost };
    }
  }

  console.log(
    `[Room] Rejoin failed: session ${sessionId} not found in room ${roomId} and no pending disconnect`
  );
  return null;
}

/**
 * Get the pending disconnect info for a session (if any).
 */
export function getPendingDisconnect(
  sessionId: string
): PendingDisconnect | null {
  return pendingDisconnects.get(sessionId) || null;
}

/**
 * Remove a participant from a room immediately (no grace period).
 * Used when grace period expires or for explicit leave.
 * Returns { room, wasHost, newHostId } or null if room not found.
 */
export function leaveRoom(
  socketId: string
): {
  room: Room;
  wasHost: boolean;
  newHostId: string | null;
  isEmpty: boolean;
} | null {
  // Find which room this socket is in
  for (const [, room] of rooms) {
    if (!room.guests.has(socketId)) continue;

    const guest = room.guests.get(socketId)!;
    const wasHost = room.hostId === socketId;
    room.guests.delete(socketId);
    sessionToSocket.delete(guest.sessionId);

    // If room is now empty, delete it
    if (room.guests.size === 0) {
      rooms.delete(room.id);
      console.log(`[Room] Room ${room.id} deleted (empty)`);
      return { room, wasHost, newHostId: null, isEmpty: true };
    }

    // If the host left, promote the first remaining guest
    let newHostId: string | null = null;
    if (wasHost) {
      const firstGuest = room.guests.values().next().value;
      if (firstGuest) {
        room.hostId = firstGuest.socketId;
        room.hostSessionId = firstGuest.sessionId;
        room.hostName = firstGuest.displayName;
        newHostId = firstGuest.socketId;
        console.log(
          `[Room] Host departed room ${room.id}. New host: ${firstGuest.displayName}`
        );
      }
    }

    return { room, wasHost, newHostId, isEmpty: false };
  }

  return null;
}

/**
 * Get a room by its ID.
 */
export function getRoom(roomId: string): Room | null {
  return rooms.get(roomId.toUpperCase()) || null;
}

/**
 * Serialize a Room to a plain object (no Maps) for sending over the wire.
 */
export function roomToSnapshot(room: Room): RoomSnapshot {
  return {
    id: room.id,
    hostId: room.hostId,
    hostName: room.hostName,
    currentVideoId: room.currentVideoId,
    currentVideoTitle: room.currentVideoTitle,
    currentTime: room.currentTime,
    isPlaying: room.isPlaying,
    queue: room.queue,
    guests: Array.from(room.guests.values()).map((g) => ({
      socketId: g.socketId,
      displayName: g.displayName,
    })),
  };
}

/**
 * Update room playback state (called when host emits sync actions).
 */
export function updatePlaybackState(
  roomId: string,
  currentTime: number,
  isPlaying: boolean
): void {
  const room = rooms.get(roomId.toUpperCase());
  if (room) {
    room.currentTime = currentTime;
    room.isPlaying = isPlaying;
  }
}

/**
 * Change the currently playing track.
 */
export function changeTrack(
  roomId: string,
  videoId: string,
  title: string
): void {
  const room = rooms.get(roomId.toUpperCase());
  if (room) {
    room.currentVideoId = videoId;
    room.currentVideoTitle = title;
    room.currentTime = 0;
    room.isPlaying = true;
  }
}

/**
 * Add a track to the room's queue.
 */
export function addToQueue(
  roomId: string,
  videoId: string,
  title: string,
  addedBy: string
): QueueItem | null {
  const room = rooms.get(roomId.toUpperCase());
  if (!room) return null;

  const item: QueueItem = {
    id: uuidv4(),
    videoId,
    title,
    addedBy,
  };

  room.queue.push(item);
  return item;
}

/**
 * Remove and return the next track from the queue.
 */
export function popFromQueue(roomId: string): QueueItem | null {
  const room = rooms.get(roomId.toUpperCase());
  if (!room || room.queue.length === 0) return null;
  return room.queue.shift() || null;
}

/**
 * Find which room a socket belongs to.
 */
export function findRoomBySocket(socketId: string): Room | null {
  for (const [, room] of rooms) {
    if (room.guests.has(socketId)) return room;
  }
  return null;
}
