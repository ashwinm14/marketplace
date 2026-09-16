"use client";

import { GameProvider } from "@/context/GameContext";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <GameProvider>
      {children}
    </GameProvider>
  );
}
