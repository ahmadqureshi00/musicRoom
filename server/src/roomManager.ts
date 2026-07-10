// ─── Room Manager ─────────────────────────────────────────────
// In-memory room state management. No database needed for MVP.

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
  displayName: string;
}

export interface Room {
  id: string;
  hostId: string;
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
export function createRoom(hostSocketId: string, hostName: string): Room {
  const roomId = generateRoomCode();
  const room: Room = {
    id: roomId,
    hostId: hostSocketId,
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
    displayName: hostName,
  });

  rooms.set(roomId, room);
  console.log(`[Room] Created room ${roomId} by ${hostName} (${hostSocketId})`);
  return room;
}

/**
 * Add a guest to an existing room.
 * Returns the room or null if not found.
 */
export function joinRoom(
  roomId: string,
  guestSocketId: string,
  guestName: string
): Room | null {
  const room = rooms.get(roomId.toUpperCase());
  if (!room) return null;

  room.guests.set(guestSocketId, {
    socketId: guestSocketId,
    displayName: guestName,
  });

  console.log(
    `[Room] ${guestName} (${guestSocketId}) joined room ${room.id}`
  );
  return room;
}

/**
 * Remove a participant from a room.
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

    const wasHost = room.hostId === socketId;
    room.guests.delete(socketId);

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
    guests: Array.from(room.guests.values()),
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
