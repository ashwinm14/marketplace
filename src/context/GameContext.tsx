"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export type Phase = "SETUP" | "INTRO" | "BUILDING" | "PITCHING" | "MARKET" | "END";

export interface GameState {
  id: string;
  current_phase: Phase;
  timer_ends_at: string | null;
  timer_duration_ms: number;
  is_paused: boolean;
  active_buzzer_team_id: string | null;
  active_buzzer_timestamp: string | null;
}

interface GameContextType {
  gameState: GameState | null;
  loading: boolean;
  timeLeft: number; // in milliseconds
}

const GameContext = createContext<GameContextType>({
  gameState: null,
  loading: true,
  timeLeft: 0,
});

export function GameProvider({ children }: { children: React.ReactNode }) {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [loading, setLoading] = useState(true);
  const [timeLeft, setTimeLeft] = useState(0);

  useEffect(() => {
    // Initial fetch
    const fetchState = async () => {
      // Use limit(1) instead of single() in case multiple rows were inserted by running schema.sql multiple times
      const { data, error } = await supabase.from("game_state").select("*").limit(1);
      
      if (!error && data && data.length > 0) {
        setGameState(data[0]);
      } else if (!error && (!data || data.length === 0)) {
        // Self-heal: If the table is completely empty, insert a row automatically!
        const { data: newData, error: insertError } = await supabase
          .from("game_state")
          .insert([{ current_phase: "SETUP" }])
          .select()
          .single();
          
        if (!insertError && newData) {
          setGameState(newData);
        }
      } else if (error) {
        console.error("Error fetching game state:", error);
      }
      setLoading(false);
    };

    fetchState();

    // Subscribe to realtime changes
    const channel = supabase
      .channel("game_state_changes")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "game_state" },
        (payload) => {
          setGameState(payload.new as GameState);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Timer logic
  useEffect(() => {
    if (!gameState || gameState.is_paused || !gameState.timer_ends_at) {
      if (gameState?.is_paused && gameState.timer_duration_ms > 0) {
          // Display the frozen remaining time stored in the DB
          setTimeLeft(gameState.timer_duration_ms);
      }
      return;
    }

    const interval = setInterval(() => {
      const end = new Date(gameState.timer_ends_at!).getTime();
      const now = new Date().getTime();
      const remaining = end - now;
      
      if (remaining <= 0) {
        setTimeLeft(0);
        clearInterval(interval);
      } else {
        setTimeLeft(remaining);
      }
    }, 100);

    return () => clearInterval(interval);
  }, [gameState]);

  return (
    <GameContext.Provider value={{ gameState, loading, timeLeft }}>
      {children}
    </GameContext.Provider>
  );
}

export const useGame = () => useContext(GameContext);
