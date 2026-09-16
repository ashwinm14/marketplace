"use client";

import { useState, useEffect } from "react";
import { useGame } from "@/context/GameContext";
import { supabase } from "@/lib/supabase";

export default function TimerDisplay() {
  const { gameState, loading, timeLeft } = useGame();
  const [activeTeamName, setActiveTeamName] = useState("");

  useEffect(() => {
    if (gameState?.current_phase === "PITCHING" && gameState?.active_buzzer_team_id) {
      supabase.from("teams").select("name").eq("id", gameState.active_buzzer_team_id).single().then(({data}) => {
        if (data) setActiveTeamName(data.name);
      });
    } else {
      setActiveTeamName("");
    }
  }, [gameState?.current_phase, gameState?.active_buzzer_team_id]);

  const formatTime = (ms: number) => {
    if (ms <= 0) return "00:00:00";
    const totalSeconds = Math.floor(ms / 1000);
    const h = Math.floor(totalSeconds / 3600).toString().padStart(2, "0");
    const m = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, "0");
    const s = (totalSeconds % 60).toString().padStart(2, "0");
    return `${h}:${m}:${s}`;
  };

  if (loading) return <div className="flex-center" style={{ height: "100vh" }}>Loading...</div>;

  return (
    <div className="flex-center" style={{ minHeight: "100vh", padding: "2rem", flexDirection: "column" }}>

      <div className="glass-panel text-center" style={{ width: "80%", maxWidth: "800px" }}>
        {activeTeamName ? (
          <h2 className="text-cyan animate-pulse-glow" style={{ fontSize: "3.5rem", textTransform: "uppercase", letterSpacing: "4px", color: "var(--neon-green)", textShadow: "0 0 20px rgba(0, 255, 127, 0.6)" }}>
            {activeTeamName} IS PITCHING
          </h2>
        ) : (
          <h2 className="text-cyan" style={{ fontSize: "3rem", textTransform: "uppercase", letterSpacing: "4px" }}>
            {gameState?.current_phase} PHASE
          </h2>
        )}
        
        <div style={{ margin: "4rem 0" }}>
          <span className="text-pink" style={{ 
            fontSize: "8rem", 
            fontWeight: "900", 
            fontFamily: "monospace",
            textShadow: "0 0 40px rgba(255, 0, 127, 0.6)"
          }}>
            {formatTime(timeLeft)}
          </span>
        </div>
        
        {gameState?.is_paused && (
          <h3 className="text-muted" style={{ fontSize: "2rem" }}>PAUSED</h3>
        )}
      </div>
    </div>
  );
}
