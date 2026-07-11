// ─── MusicRoom Server ─────────────────────────────────────────
// Express + Socket.io server for real-time music synchronization.

import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import { registerSocketHandlers } from "./socketHandlers";

const app = express();
const httpServer = createServer(app);

// ─── CORS ────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  "http://localhost:3000", // Next.js dev
  "http://127.0.0.1:3000",
  "https://music-room-ashen.vercel.app"
];

app.use(
  cors({
    origin: ALLOWED_ORIGINS,
    methods: ["GET", "POST"],
  })
);

app.use(express.json());

// ─── Socket.io ───────────────────────────────────────────────
const io = new Server(httpServer, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ["GET", "POST"],
  },
  pingInterval: 10000,
  pingTimeout: 5000,
});

// Register all socket event handlers
registerSocketHandlers(io);

// ─── Health Check ────────────────────────────────────────────
app.get("/", (_req, res) => {
  res.json({
    status: "ok",
    service: "MusicRoom Sync Server",
    timestamp: new Date().toISOString(),
  });
});

app.get("/health", (_req, res) => {
  res.json({ status: "healthy" });
});

// ─── Start ───────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;

httpServer.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════════╗
  ║   🎵 MusicRoom Sync Server               ║
  ║   Running on http://localhost:${PORT}        ║
  ╚═══════════════════════════════════════════╝
  `);
});
