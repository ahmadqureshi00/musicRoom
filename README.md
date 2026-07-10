# 🎵 MusicRoom

**Listen to music together in perfect sync — no matter where you are.**

MusicRoom is a real-time synchronized YouTube listening party app. Create a room, share the code with friends, and enjoy music together with millisecond-level playback sync.

## Features

- **Room Management** — Create or join rooms with a unique 6-character code
- **Real-time Sync** — Play, pause, and seek are mirrored instantly across all connected devices
- **Shared Queue** — Everyone can add tracks to the upcoming playlist
- **Drift Correction** — Background sync every 5 seconds keeps everyone aligned
- **Autoplay Compliance** — "Tap to Sync" overlay for mobile browser autoplay policies
- **Host Promotion** — If the host leaves, the next guest is automatically promoted

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15, Tailwind CSS v4, TypeScript |
| Player | YouTube Iframe Player API |
| Backend | Node.js, Express, Socket.io |
| Real-time | WebSockets (Socket.io) |

## Getting Started

### Prerequisites

- Node.js 18+
- npm

### 1. Start the Backend

```bash
cd server
npm install
npm run dev
```

The sync server will start on `http://localhost:3001`.

### 2. Start the Frontend

```bash
cd client
npm install
npm run dev
```

The app will open at `http://localhost:3000`.

### 3. Use It

1. Open `http://localhost:3000` in your browser
2. Click **Create Party** and enter your name
3. Share the **Room ID** with friends
4. Friends open the same URL, click **Join Party**, and enter the Room ID
5. Paste a YouTube URL and hit Play — everyone hears it in sync!

## Project Structure

```
musicroom/
├── client/          # Next.js frontend
│   └── src/
│       ├── app/           # Pages (landing + room)
│       ├── components/    # React components
│       ├── context/       # Socket.io React context
│       ├── hooks/         # Custom hooks (YouTube, Socket)
│       └── lib/           # Utilities
├── server/          # Express + Socket.io backend
│   └── src/
│       ├── index.ts           # Server entry
│       ├── roomManager.ts     # In-memory room state
│       └── socketHandlers.ts  # Socket event handlers
└── README.md
```

## Architecture

```
[ Host Device ] → (Play/Pause/Seek)
       │
       ▼  Socket.io Event
[ Node.js Server ]
       │
       ▼  Broadcast to room
[ Guest 1 ] [ Guest 2 ] [ Guest 3 ]
       ↓         ↓           ↓
   YouTube    YouTube     YouTube
   Player     Player      Player
   (synced)   (synced)    (synced)
```

## License

MIT
