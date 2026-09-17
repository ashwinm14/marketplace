"use client";

import { useState, useEffect } from "react";
import { useGame } from "@/context/GameContext";
import { supabase, supabaseUrl } from "@/lib/supabase";

export default function AdminDashboard() {
  const { gameState, loading, timeLeft } = useGame();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [teams, setTeams] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [newTeamName, setNewTeamName] = useState("");
  const [newTeamPin, setNewTeamPin] = useState("");
  const [editingTeam, setEditingTeam] = useState<any>(null);
  const [notifications, setNotifications] = useState<any[]>([]);
  
  const fetchTeams = async () => {
    if (supabaseUrl === 'https://placeholder.supabase.co') return; 
    const { data, error } = await supabase.from("teams").select("*").order("created_at");
    if (error) console.error("Fetch teams error:", error);
    if (data) setTeams(data);
  };

  const fetchTransactions = async () => {
    if (supabaseUrl === 'https://placeholder.supabase.co') return;
    const { data, error } = await supabase.from("transactions").select("*");
    if (error) console.error("Fetch transactions error:", error);
    if (data) setTransactions(data);
  };

  useEffect(() => {
    const savedAuth = sessionStorage.getItem("admin_auth");
    if (savedAuth === "true") setIsAuthenticated(true);

    fetchTeams();
    fetchTransactions();
    
    const fetchNotifications = async () => {
      if (supabaseUrl === 'https://placeholder.supabase.co') return;
      const { data, error } = await supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(20);
      if (error) {
        console.error("Notification Error:", error);
        alert("Database Error: " + error.message);
      }
      if (data) setNotifications(data);
    };
    fetchNotifications();

    if (supabaseUrl === 'https://placeholder.supabase.co') return;
    
    const channel = supabase.channel("teams_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "teams" }, fetchTeams)
      .subscribe();

    const txChannel = supabase.channel("tx_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "transactions" }, fetchTransactions)
      .subscribe();

    const notifChannel = supabase
      .channel("notifications_changes")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications" }, (payload) => {
        setNotifications(prev => [payload.new, ...prev].slice(0, 20));
      })
      .subscribe();

    return () => { 
      supabase.removeChannel(channel); 
      supabase.removeChannel(txChannel);
      supabase.removeChannel(notifChannel);
    };
  }, []);

  const createTeam = async () => {
    if (!newTeamName || !newTeamPin) return;
    
    if (supabaseUrl === 'https://placeholder.supabase.co') {
      alert("Error: Supabase is not connected.");
      return;
    }

    const { error } = await supabase.from("teams").insert([{ name: newTeamName, pin_code: newTeamPin }]);
    
    if (error) {
      console.error("Team creation error:", error);
      alert(`Failed to create team: ${error.message}\n(Make sure you ran the schema.sql in Supabase!)`);
    } else {
      setNewTeamName("");
      setNewTeamPin("");
      fetchTeams(); 
    }
  };

  const setPhase = async (phase: string) => {
    if (!gameState?.id) return alert("Game state missing! Re-run the INSERT statement in schema.sql.");
    await supabase.from("game_state").update({ 
      current_phase: phase,
      active_buzzer_team_id: null,
      is_paused: true,
      timer_ends_at: null,
      timer_duration_ms: 0
    }).eq("id", gameState?.id);
  };

  const startTimer = async (minutes: number) => {
    if (!gameState?.id) return;
    const endsAt = new Date(new Date().getTime() + minutes * 60000).toISOString();
    await supabase.from("game_state").update({
      timer_ends_at: endsAt,
      timer_duration_ms: minutes * 60000,
      is_paused: false,
    }).eq("id", gameState?.id);
  };

  const startPitchTimer = async (teamId: string) => {
    if (!gameState?.id) return;
    
    const minutes = 4;
    const endsAt = new Date(new Date().getTime() + minutes * 60000).toISOString();
    
    await supabase.from("game_state").update({
      timer_ends_at: endsAt,
      timer_duration_ms: minutes * 60000,
      is_paused: false,
      active_buzzer_team_id: teamId 
    }).eq("id", gameState.id);
  };

  const stopAndScorePitch = async (teamId: string) => {
    if (!gameState?.id) return;
    
    await stopTimer();
    
    let points = 5;
    // Award 10 points if they pitched for at least 3 minutes (out of 4 max), i.e. 1 minute or less remaining
    if (timeLeft <= 60000) {
      points = 10;
    }
    
    await supabase.from("teams").update({ score_pitching: points }).eq("id", teamId);
    await supabase.from("game_state").update({ active_buzzer_team_id: null }).eq("id", gameState.id);
    
    alert(`Pitch complete! Awarded ${points} points to this team.`);
  };

  const resetEntireGame = async () => {
    if (!gameState?.id) return;
    
    const confirm1 = window.confirm("CRITICAL WARNING: Are you sure you want to completely RESET the entire game? This will DELETE all teams, all products, and all scores! This CANNOT be undone!");
    if (!confirm1) return;
    
    const confirm2 = window.prompt("Type 'RESET' to confirm this destructive action:");
    if (confirm2 !== "RESET") return;
    
    await supabase.from("teams").delete().gte("balance", 0);
    
    await supabase.from("game_state").update({
      current_phase: "SETUP",
      timer_ends_at: null,
      timer_duration_ms: 0,
      is_paused: true,
      active_buzzer_team_id: null
    }).eq("id", gameState.id);
    
    await supabase.from("notifications").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    setNotifications([]); 
    
    alert("Game completely reset to factory defaults!");
  };

  const stopTimer = async () => {
    if (!gameState?.id || !gameState?.timer_ends_at) return;
    
    const now = new Date().getTime();
    const end = new Date(gameState.timer_ends_at).getTime();
    const remainingMs = Math.max(0, end - now);
    
    await supabase.from("game_state").update({ 
      is_paused: true,
      timer_duration_ms: remainingMs,
      timer_ends_at: null
    }).eq("id", gameState?.id);
  };

  const resumeTimer = async () => {
    if (!gameState?.id || !gameState?.is_paused || !gameState?.timer_duration_ms) return;
    
    const endsAt = new Date(new Date().getTime() + gameState.timer_duration_ms).toISOString();
    
    await supabase.from("game_state").update({
      timer_ends_at: endsAt,
      is_paused: false,
    }).eq("id", gameState?.id);
  };

  const resetTimer = async () => {
    if (!gameState?.id) return;
    await supabase.from("game_state").update({ timer_ends_at: null, timer_duration_ms: 0, is_paused: true }).eq("id", gameState?.id);
  };

  const calculateFinalScores = async () => {
    const { data: currentTeams } = await supabase.from("teams").select("*");
    if (!currentTeams) return;

    const updates = currentTeams.map(team => {
      const score_market_sell = team.items_sold >= 3 ? 10 : 5;
      const score_market_buy = team.items_bought >= 3 ? 10 : 5;

      return {
        ...team,
        score_market_sell,
        score_market_buy
      };
    });

    updates.sort((a, b) => b.balance - a.balance);

    let currentRankPoints = 16;
    const finalUpdates = updates.map((team, index) => {
      const rank_points = currentRankPoints - (index * 6);
      return {
        id: team.id,
        score_market_sell: team.score_market_sell,
        score_market_buy: team.score_market_buy,
        rank_points: rank_points
      };
    });

    for (const update of finalUpdates) {
      await supabase.from("teams").update(update).eq("id", update.id);
    }
    
    alert("Final scores calculated successfully!");
  };

  const formatTime = (ms: number) => {
    if (ms <= 0) return "00:00";
    const totalSeconds = Math.floor(ms / 1000);
    const m = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
    const s = (totalSeconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  const saveTeamEdits = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTeam) return;
    
    await supabase.from("teams").update({
      name: editingTeam.name,
      pin_code: editingTeam.pin_code,
      balance: editingTeam.balance,
      score_building: editingTeam.score_building,
      score_pitching: editingTeam.score_pitching,
      score_market_sell: editingTeam.score_market_sell,
      score_market_buy: editingTeam.score_market_buy,
      rank_points: editingTeam.rank_points
    }).eq("id", editingTeam.id);
    
    setEditingTeam(null);
    alert("Team updated successfully!");
  };

  const deleteTeam = async (teamId: string) => {
    if (!window.confirm("Are you sure you want to completely DELETE this team? All their products and transactions will also be lost. This cannot be undone!")) return;
    
    const { error } = await supabase.from("teams").delete().eq("id", teamId);
    if (error) {
      alert(`Failed to delete: ${error.message}`);
    } else {
      setEditingTeam(null);
      alert("Team deleted successfully!");
    }
  };

  if (loading) return <div className="flex-center" style={{ height: "100vh" }}>Loading...</div>;

  if (!isAuthenticated) {
    return (
      <div className="flex-center" style={{ height: "100vh", padding: "1rem" }}>
        <div className="glass-panel text-center" style={{ width: "100%", maxWidth: "400px" }}>
          <h2 className="text-purple">Admin Command Center</h2>
          <form onSubmit={(e) => {
            e.preventDefault();
            if (adminPassword === "Ashwin@iedc") {
              setIsAuthenticated(true);
              sessionStorage.setItem("admin_auth", "true");
            } else {
              alert("Incorrect password!");
            }
          }} style={{ display: "flex", flexDirection: "column", gap: "1rem", marginTop: "2rem" }}>
            <input 
              type="password" 
              placeholder="Enter Access Key" 
              className="glass-input text-center" 
              value={adminPassword}
              onChange={e => setAdminPassword(e.target.value)}
              autoFocus
            />
            <button type="submit" className="btn-neon purple">Authenticate</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "2rem" }}>
      <h1 className="text-cyan">Admin Command Center</h1>
      
      <div className="admin-grid">
        
        {/* Left Column: Controls & Teams */}
        <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
          {/* Game Controls */}
          <div className="glass-panel">
          <h2>Game Control</h2>
          <div style={{ marginBottom: "1rem" }}>
            <strong>Current Phase: </strong>
            <span className="text-cyan" style={{ fontSize: "1.2rem", fontWeight: "bold" }}>
              {gameState?.current_phase}
            </span>
          </div>
          
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "2rem" }}>
            <button className="btn-neon" onClick={() => setPhase("SETUP")}>Setup</button>
            <button className="btn-neon" onClick={() => setPhase("INTRO")}>Intro</button>
            <button className="btn-neon" onClick={() => setPhase("BUILDING")}>Building</button>
            <button className="btn-neon" onClick={() => setPhase("PITCHING")}>Pitching</button>
            <button className="btn-neon" onClick={() => setPhase("MARKET")}>Market</button>
            <button className="btn-neon" onClick={() => setPhase("END")}>End</button>
          </div>

          <div style={{ marginBottom: "1rem" }}>
            <strong>Timer: </strong>
            <span className="text-pink" style={{ fontSize: "2rem", fontWeight: "bold", fontFamily: "monospace" }}>
              {formatTime(timeLeft)}
            </span>
          </div>

          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button className="btn-neon pink" onClick={() => startTimer(15)}>Start 15m (Intro)</button>
            <button className="btn-neon pink" onClick={() => startTimer(45)}>Start 45m (Build)</button>
            <button className="btn-neon pink" onClick={() => startTimer(10)}>Start +10m (Ext)</button>
            <button className="btn-neon pink" onClick={() => startTimer(4)}>Start 4m (Team Pitch)</button>
            <button className="btn-neon pink" onClick={() => startTimer(75)}>Start 1h15m (Total Pitch)</button>
            <button className="btn-neon pink" onClick={() => startTimer(30)}>Start 30m (Market)</button>
            {gameState?.is_paused && gameState?.timer_duration_ms > 0 ? (
              <button className="btn-neon pink" onClick={resumeTimer}>Resume</button>
            ) : (
              <button className="btn-neon pink" onClick={stopTimer}>Pause</button>
            )}
            <button className="btn-neon purple" onClick={resetTimer}>Reset Timer</button>
          </div>
          
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "1rem", borderTop: "1px solid rgba(255,0,0,0.3)", paddingTop: "1rem" }}>
            <button className="btn-neon" style={{ borderColor: "var(--neon-pink)", color: "var(--neon-pink)" }} onClick={resetEntireGame}>
              ⚠️ RESET ENTIRE GAME
            </button>
          </div>
          
          {gameState?.current_phase === "BUILDING" && gameState?.active_buzzer_team_id && (
            <div style={{ marginTop: "1.5rem", padding: "1rem", border: "2px solid var(--neon-green)", borderRadius: "8px", background: "rgba(17, 127, 45, 0.2)" }} className="animate-pulse-glow">
              <h3 className="text-green" style={{ margin: 0 }}>🚨 BUZZER PRESSED!</h3>
              <p style={{ fontSize: "1.2rem", marginTop: "0.5rem" }}>
                <strong>{teams.find(t => t.id === gameState.active_buzzer_team_id)?.name}</strong> just finished their product and secured points!
              </p>
            </div>
          )}
        </div>

        {/* Team Management */}
        <div className="glass-panel">
          <h2>Teams ({teams.length})</h2>
          
          {gameState?.current_phase === "SETUP" ? (
            <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem" }}>
              <input 
                type="text" 
                placeholder="Team Name" 
                className="glass-input" 
                value={newTeamName} 
                onChange={e => setNewTeamName(e.target.value)} 
              />
              <input 
                type="text" 
                placeholder="PIN" 
                className="glass-input" 
                value={newTeamPin} 
                onChange={e => setNewTeamPin(e.target.value)} 
              />
              <button className="btn-neon" onClick={createTeam}>Add</button>
            </div>
          ) : (
            <p className="text-pink animate-pulse-glow" style={{ marginBottom: "1rem", padding: "0.5rem", border: "1px solid var(--neon-pink)", borderRadius: "4px" }}>
              Lobby is CLOSED. Game has started!
            </p>
          )}
          
          <div style={{ maxHeight: "300px", overflowY: "auto", marginBottom: "1rem" }}>
            <table style={{ width: "100%", textAlign: "left", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--glass-border)", fontSize: "0.9rem" }}>
                  <th style={{ padding: "0.5rem" }}>Name</th>
                  <th>PIN</th>
                  <th>Revenue</th>
                  <th>Spent</th>
                  <th>Balance</th>
                  <th>Points</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {teams.map(team => {
                  const teamRevenue = transactions.filter(t => t.seller_team_id === team.id).reduce((s, t) => s + t.amount, 0);
                  const teamSpent = transactions.filter(t => t.buyer_team_id === team.id).reduce((s, t) => s + t.amount, 0);

                  return (
                    <tr key={team.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                      <td style={{ padding: "0.5rem" }}>{team.name}</td>
                      <td>{team.pin_code}</td>
                      <td className="text-cyan">₹{teamRevenue}</td>
                      <td className="text-pink">₹{teamSpent}</td>
                      <td className="text-green">₹{team.balance}</td>
                      <td className="text-purple">{(team.score_building || 0) + (team.score_pitching || 0) + (team.score_market_sell || 0) + (team.score_market_buy || 0) + (team.rank_points || 0)}</td>
                      <td>
                        <div style={{ display: "flex", gap: "0.5rem" }}>
                          <button 
                            style={{ background: 'transparent', color: 'var(--neon-purple)', border: '1px solid var(--neon-purple)', padding: '2px 8px', borderRadius: '4px', cursor: 'pointer' }}
                            onClick={() => setEditingTeam(team)}
                          >
                            Manage
                          </button>
                          
                          {gameState?.current_phase === "PITCHING" && (
                            gameState.active_buzzer_team_id === team.id ? (
                              <button 
                                className="btn-neon pink" 
                                style={{ padding: '2px 8px', fontSize: '0.8rem' }}
                                onClick={() => stopAndScorePitch(team.id)}
                              >
                                STOP & SCORE
                              </button>
                            ) : (
                              <button 
                                className="btn-neon green" 
                                style={{ padding: '2px 8px', fontSize: '0.8rem' }}
                                onClick={() => startPitchTimer(team.id)}
                                disabled={!!gameState.active_buzzer_team_id}
                              >
                                Start Pitch
                              </button>
                            )
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          
          <div style={{ borderTop: "1px solid var(--glass-border)", paddingTop: "1rem" }}>
            <button className="btn-neon green" style={{ width: "100%", borderColor: "var(--neon-green)", color: "var(--neon-green)" }} onClick={calculateFinalScores}>
              Calculate Final Market & Rank Scores
            </button>
          </div>
        </div>
        
        {/* End Left Column */}
        </div>

        {/* Right Column: Live Activity */}
        <div className="glass-panel" style={{ display: "flex", flexDirection: "column", maxHeight: "100vh", position: "sticky", top: "2rem" }}>
          <h2 className="text-pink">Live Activity</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem", overflowY: "auto", flex: 1, paddingRight: "0.5rem" }}>
            {notifications.length === 0 ? (
              <p className="text-muted">No activity yet...</p>
            ) : (
              notifications.map((notif, idx) => (
                <div key={idx} style={{ 
                  padding: "0.75rem", 
                  background: notif.type === "buzzer" ? "rgba(237, 84, 186, 0.1)" : "rgba(56, 254, 220, 0.1)", 
                  borderLeft: `4px solid ${notif.type === "buzzer" ? "var(--neon-pink)" : "var(--neon-cyan)"}`,
                  borderRadius: "4px"
                }}>
                  <p style={{ margin: 0, fontSize: "0.9rem" }}>{notif.message}</p>
                  <small className="text-muted">{new Date(notif.created_at).toLocaleTimeString()}</small>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
      
      {/* Edit Modal Overlay */}
      {editingTeam && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.8)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div className="glass-panel" style={{ width: "400px", padding: "2rem", background: "var(--space-dark)" }}>
            <div className="flex-between" style={{ marginBottom: "1rem" }}>
              <h2 className="text-cyan" style={{ margin: 0 }}>Edit Team: {editingTeam.name}</h2>
              <button className="btn-neon" style={{ borderColor: "var(--neon-pink)", color: "var(--neon-pink)", padding: "0.25rem 0.5rem" }} onClick={() => deleteTeam(editingTeam.id)}>
                Delete Team
              </button>
            </div>
            
            <form onSubmit={saveTeamEdits} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div><label>Name</label><input className="glass-input" value={editingTeam.name} onChange={e => setEditingTeam({...editingTeam, name: e.target.value})} /></div>
              <div><label>PIN</label><input className="glass-input" value={editingTeam.pin_code} onChange={e => setEditingTeam({...editingTeam, pin_code: e.target.value})} /></div>
              <div><label>Balance (₹)</label><input type="number" className="glass-input" value={editingTeam.balance} onChange={e => setEditingTeam({...editingTeam, balance: parseInt(e.target.value) || 0})} /></div>
              <div><label>Building Pts</label><input type="number" className="glass-input" value={editingTeam.score_building} onChange={e => setEditingTeam({...editingTeam, score_building: parseInt(e.target.value) || 0})} /></div>
              <div><label>Pitching Pts</label><input type="number" className="glass-input" value={editingTeam.score_pitching} onChange={e => setEditingTeam({...editingTeam, score_pitching: parseInt(e.target.value) || 0})} /></div>
              <div><label>Market Sell Pts</label><input type="number" className="glass-input" value={editingTeam.score_market_sell} onChange={e => setEditingTeam({...editingTeam, score_market_sell: parseInt(e.target.value) || 0})} /></div>
              <div><label>Market Buy Pts</label><input type="number" className="glass-input" value={editingTeam.score_market_buy} onChange={e => setEditingTeam({...editingTeam, score_market_buy: parseInt(e.target.value) || 0})} /></div>
              <div><label>Rank Pts</label><input type="number" className="glass-input" value={editingTeam.rank_points} onChange={e => setEditingTeam({...editingTeam, rank_points: parseInt(e.target.value) || 0})} /></div>
              
              <div style={{ display: "flex", gap: "1rem", marginTop: "1rem" }}>
                <button type="submit" className="btn-neon green" style={{ flex: 1 }}>Save Changes</button>
                <button type="button" className="btn-neon pink" style={{ flex: 1 }} onClick={() => setEditingTeam(null)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
