import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { SocketProvider } from "@/context/SocketContext";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800", "900"],
});

export const metadata: Metadata = {
  title: "MusicRoom — Listen Together, Anywhere",
  description:
    "Create a virtual room, share a YouTube link, and listen to music in perfect sync with your friends. Real-time playback synchronization powered by WebSockets.",
  keywords: ["music", "sync", "listen together", "youtube", "party", "room"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <SocketProvider>{children}</SocketProvider>
      </body>
    </html>
  );
}
