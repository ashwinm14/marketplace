"use client";

import { useState, useEffect } from "react";
import { useGame } from "@/context/GameContext";
import { supabase } from "@/lib/supabase";
import { QRCodeSVG } from "qrcode.react";
import { Scanner } from "@yudiel/react-qr-scanner";

export default function LeaderScreen() {
  const { gameState, loading, timeLeft } = useGame();
  
  // Auth state
  const [pin, setPin] = useState("");
  const [team, setTeam] = useState<any>(null);
  const [authError, setAuthError] = useState("");
  
  // Market state
  const [products, setProducts] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [newProductName, setNewProductName] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Scanner state
  const [isScanning, setIsScanning] = useState(false);
  const [paymentProduct, setPaymentProduct] = useState<any>(null);
  const [paymentAmount, setPaymentAmount] = useState("");

  // Re-fetch team data when it changes
  useEffect(() => {
    const savedTeamId = localStorage.getItem("evolvia_team_id");
    
    if (!team && savedTeamId) {
      const fetchSavedTeam = async () => {
        const { data } = await supabase.from("teams").select("*").eq("id", savedTeamId).single();
        if (data) setTeam(data);
      };
      fetchSavedTeam();
      return; 
    }
    
    if (!team) return;
    
    const fetchTeam = async () => {
      const { data } = await supabase.from("teams").select("*").eq("id", team.id).single();
      if (data) setTeam(data);
    };
    fetchTeam();
    
    const channelTeam = supabase.channel(`team_${team.id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "teams", filter: `id=eq.${team.id}` }, fetchTeam)
      .subscribe();
      
    const fetchProducts = async () => {
      const { data } = await supabase.from("products").select("*, teams(name)");
      if (data) setProducts(data);
    };
    fetchProducts();
    
    const channelProducts = supabase.channel("products_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "products" }, fetchProducts)
      .subscribe();

    const fetchTransactions = async () => {
      const { data } = await supabase.from("transactions").select("*").or(`seller_team_id.eq.${team.id},buyer_team_id.eq.${team.id}`);
      if (data) setTransactions(data);
    };
    fetchTransactions();
    
    const channelTransactions = supabase.channel(`transactions_${team.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "transactions" }, fetchTransactions)
      .subscribe();
      
    return () => { 
      supabase.removeChannel(channelTeam); 
      supabase.removeChannel(channelProducts);
      supabase.removeChannel(channelTransactions);
    };
  }, [team?.id]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    const { data, error } = await supabase.from("teams").select("*").eq("pin_code", pin).single();
    
    if (error || !data) {
      setAuthError("Invalid PIN");
    } else {
      localStorage.setItem("evolvia_team_id", data.id);
      setTeam(data);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("evolvia_team_id");
    setTeam(null);
  };

  const handleBuzzer = async () => {
    if (team.has_buzzed) return;
    
    let points = 1;
    if (gameState?.timer_duration_ms === 45 * 60000 && timeLeft > 0) {
      points = 10;
    } else if (gameState?.timer_duration_ms === 10 * 60000 && timeLeft > 0) {
      points = 5;
    }
    
    await supabase.from("teams").update({ 
      has_buzzed: true,
      score_building: points
    }).eq("id", team.id);
    
    await supabase.from("game_state").update({ 
      active_buzzer_team_id: team.id,
      active_buzzer_timestamp: new Date().toISOString()
    }).eq("id", gameState?.id);
    
    const { count } = await supabase.from("teams").select("*", { count: "exact", head: true }).eq("has_buzzed", true);
    const rank = count || 1;
    let rankStr = rank + "th";
    if (rank === 1) rankStr = "1st";
    if (rank === 2) rankStr = "2nd";
    if (rank === 3) rankStr = "3rd";
    
    await supabase.from("notifications").insert([{
      message: `🚨 [${rankStr}] ${team.name} finished building and hit the buzzer!`,
      type: "buzzer"
    }]);
  };

  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProductName) return;
    
    await supabase.from("products").insert([{
      team_id: team.id,
      name: newProductName,
      price: 0
    }]);
    
    setNewProductName("");
  };

  const handleScan = (detectedCodes: any[]) => {
    if (detectedCodes.length > 0) {
      const scannedId = detectedCodes[0].rawValue;
      const product = products.find(p => p.id === scannedId);
      if (product) {
        if (product.team_id === team.id) {
          alert("You cannot buy your own product!");
          setIsScanning(false);
          return;
        }
        
        // Check if already bought
        const alreadyBought = transactions.some(t => t.buyer_team_id === team.id && t.product_id === product.id);
        if (alreadyBought) {
          alert("You have already bought this product!");
          setIsScanning(false);
          return;
        }

        setIsScanning(false);
        setPaymentProduct(product);
      }
    }
  };

  const handlePay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentProduct || !paymentAmount) return;
    
    const amount = parseInt(paymentAmount);
    if (isNaN(amount) || amount <= 0) return;

    if (team.balance < amount) {
      alert("Insufficient funds!");
      return;
    }
    
    setIsProcessing(true);
    const { error } = await supabase.rpc('process_buy_transaction', {
      p_buyer_id: team.id,
      p_product_id: paymentProduct.id,
      p_amount: amount
    });
    
    if (error) {
      alert(`Payment failed: ${error.message}`);
    } else {
      alert("Payment successful!");
      setPaymentProduct(null);
      setPaymentAmount("");
    }
    setIsProcessing(false);
  };

  const formatTime = (ms: number) => {
    if (ms <= 0) return "00:00";
    const totalSeconds = Math.floor(ms / 1000);
    const m = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
    const s = (totalSeconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  if (loading) return <div className="flex-center" style={{ height: "100vh" }}>Loading...</div>;

  if (!team) {
    return (
      <div className="flex-center" style={{ height: "100vh", padding: "1rem" }}>
        <div className="glass-panel" style={{ width: "100%", maxWidth: "400px" }}>
          <h2 className="text-cyan text-center">Team Login</h2>
          <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: "1rem", marginTop: "2rem" }}>
            <input 
              type="password" 
              placeholder="Enter Team PIN" 
              className="glass-input pin-input" 
              value={pin}
              onChange={e => setPin(e.target.value)}
            />
            {authError && <p className="text-pink text-center">{authError}</p>}
            <button type="submit" className="btn-neon">Access System</button>
          </form>
        </div>
      </div>
    );
  }

  const myProduct = products.find(p => p.team_id === team.id);
  const salesRevenue = transactions.filter(t => t.seller_team_id === team.id).reduce((sum, t) => sum + t.amount, 0);
  const amountSpent = transactions.filter(t => t.buyer_team_id === team.id).reduce((sum, t) => sum + t.amount, 0);

  return (
    <div style={{ padding: "2rem", maxWidth: "800px", margin: "0 auto" }}>
      <header className="glass-panel flex-between" style={{ marginBottom: "2rem", padding: "1rem 2rem" }}>
        <div>
          <h2 className="text-cyan" style={{ margin: 0 }}>{team.name}</h2>
          <p className="text-muted">Balance: <strong className="text-green" style={{ fontSize: "1.2rem" }}>₹{team.balance}</strong></p>
        </div>
        <div className="text-right">
          <p className="text-muted">Phase</p>
          <h3 className="text-purple">{gameState?.current_phase}</h3>
          <h2 className="text-pink" style={{ fontFamily: "monospace" }}>{formatTime(timeLeft)}</h2>
          <button className="btn-neon" style={{ padding: "0.25rem 0.5rem", fontSize: "0.8rem", marginTop: "0.5rem" }} onClick={handleLogout}>Logout</button>
        </div>
      </header>

      <div className="glass-panel text-center" style={{ minHeight: "400px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
        
        {gameState?.current_phase === "BUILDING" && (
          <div>
            <h2>Product Building Phase</h2>
            <p className="text-muted" style={{ marginBottom: "3rem" }}>Prepare your product and hit the buzzer when ready.</p>
            
            <button 
              className={`buzzer-btn ${team.has_buzzed ? 'disabled' : ''}`}
              onClick={handleBuzzer}
              disabled={team.has_buzzed}
            >
              {team.has_buzzed ? "BUZZED!" : "BUZZ"}
            </button>
            
            {team.has_buzzed && (
              <p className="text-green animate-pulse-glow" style={{ marginTop: "2rem" }}>
                Points secured! You earned {team.score_building} pts. Waiting for other teams...
              </p>
            )}
          </div>
        )}

        {gameState?.current_phase === "MARKET" && (
          <div style={{ textAlign: "left" }}>
            <h2 className="text-green" style={{ fontSize: "2.5rem", textAlign: "center", marginBottom: "1rem" }}>Global Market</h2>
            
            {/* Stats */}
            <div className="grid-cols-2" style={{ marginBottom: "2rem" }}>
              <div style={{ padding: "1.5rem", background: "rgba(255,255,255,0.02)", borderRadius: "8px" }}>
                <h3 className="text-cyan">Sales Revenue</h3>
                <p style={{ fontSize: "2.5rem", fontWeight: "bold" }} className="text-green">₹{salesRevenue}</p>
                <p className="text-muted">{team.items_sold} items sold</p>
              </div>
              <div style={{ padding: "1.5rem", background: "rgba(255,255,255,0.02)", borderRadius: "8px" }}>
                <h3 className="text-purple">Amount Spent</h3>
                <p style={{ fontSize: "2.5rem", fontWeight: "bold" }} className="text-pink">₹{amountSpent}</p>
                <p className="text-muted">{team.items_bought} items bought</p>
              </div>
            </div>

            <div style={{ display: "flex", gap: "2rem", flexDirection: "column" }}>
              {/* My Product Section */}
              <div style={{ padding: "1.5rem", border: "1px solid var(--neon-cyan)", borderRadius: "8px" }}>
                <h3 className="text-cyan text-center" style={{ marginBottom: "1rem" }}>Your Product</h3>
                {!myProduct ? (
                  <form onSubmit={handleCreateProduct} style={{ display: "flex", gap: "1rem", flexDirection: "column", maxWidth: "400px", margin: "0 auto" }}>
                    <p className="text-muted text-center">Add your product to start selling!</p>
                    <input 
                      className="glass-input" 
                      placeholder="Product Name" 
                      value={newProductName} 
                      onChange={e => setNewProductName(e.target.value)} 
                    />
                    <button type="submit" className="btn-neon">List Product</button>
                  </form>
                ) : (
                  <div className="flex-center" style={{ flexDirection: "column", gap: "1rem" }}>
                    <h2 className="text-green">{myProduct.name}</h2>
                    <p className="text-muted">Show this QR code to buyers to receive payments.</p>
                    <div style={{ background: "white", padding: "1rem", borderRadius: "8px" }}>
                      <QRCodeSVG value={myProduct.id} size={200} />
                    </div>
                  </div>
                )}
              </div>

              {/* Buy Products Section */}
              <div style={{ padding: "1.5rem", background: "rgba(255,255,255,0.05)", borderRadius: "8px", textAlign: "center" }}>
                <h3 className="text-purple" style={{ marginBottom: "1rem" }}>Buy Products</h3>
                <p className="text-muted" style={{ marginBottom: "1rem" }}>Scan another team&apos;s QR code to purchase their product.</p>
                
                {!isScanning && !paymentProduct && (
                  <button className="btn-neon purple" onClick={() => setIsScanning(true)}>
                    📷 Scan QR Code
                  </button>
                )}

                {isScanning && (
                  <div style={{ maxWidth: "400px", margin: "0 auto", position: "relative" }}>
                    <button 
                      onClick={() => setIsScanning(false)}
                      style={{ position: "absolute", top: "-30px", right: "0", background: "none", border: "none", color: "white", cursor: "pointer", zIndex: 10 }}
                    >
                      Close ✖
                    </button>
                    <Scanner onScan={handleScan} />
                  </div>
                )}

                {paymentProduct && (
                  <div className="glass-panel" style={{ maxWidth: "400px", margin: "1rem auto", border: "1px solid var(--neon-green)" }}>
                    <h3 className="text-green">Pay {paymentProduct.teams?.name}</h3>
                    <p className="text-muted" style={{ fontSize: "1.2rem", marginBottom: "1rem" }}>For: <strong>{paymentProduct.name}</strong></p>
                    
                    <form onSubmit={handlePay} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                      <input 
                        type="number"
                        className="glass-input text-center" 
                        style={{ fontSize: "1.5rem" }}
                        placeholder="Enter Amount (₹)" 
                        value={paymentAmount} 
                        onChange={e => setPaymentAmount(e.target.value)} 
                        autoFocus
                      />
                      <div className="flex-between" style={{ gap: "1rem" }}>
                        <button type="button" className="btn-neon" style={{ background: "transparent", flex: 1 }} onClick={() => setPaymentProduct(null)}>Cancel</button>
                        <button type="submit" className="btn-neon" style={{ flex: 1 }} disabled={isProcessing}>
                          {isProcessing ? "Processing..." : "Pay Now"}
                        </button>
                      </div>
                    </form>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {gameState?.current_phase === "PITCHING" && (
          <div>
            {gameState.active_buzzer_team_id === team.id ? (
              <div className="animate-pulse-glow" style={{ padding: "2rem", border: "2px solid var(--neon-green)", borderRadius: "12px", background: "rgba(0, 255, 127, 0.1)" }}>
                <h2 className="text-green" style={{ fontSize: "3rem", margin: 0, textShadow: "0 0 20px var(--neon-green)" }}>YOU ARE PITCHING!</h2>
                <p className="text-muted" style={{ fontSize: "1.2rem", marginTop: "1rem" }}>Your presentation time is active.</p>
                <div style={{ marginTop: "2rem" }}>
                  <span className="text-pink" style={{ fontSize: "5rem", fontWeight: "bold", fontFamily: "monospace", textShadow: "0 0 20px var(--neon-pink)" }}>
                    {formatTime(timeLeft)}
                  </span>
                </div>
              </div>
            ) : (
              <div>
                <h2>Pitching Phase</h2>
                <p className="text-muted" style={{ fontSize: "1.2rem" }}>
                  {gameState.active_buzzer_team_id ? "Another team is currently pitching. Please pay attention!" : "Waiting for the admin to start a pitch..."}
                </p>
                {gameState.active_buzzer_team_id && (
                  <div style={{ marginTop: "2rem" }}>
                    <span className="text-pink" style={{ fontSize: "3rem", fontWeight: "bold", fontFamily: "monospace", opacity: 0.7 }}>
                      {formatTime(timeLeft)}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {(gameState?.current_phase !== "BUILDING" && gameState?.current_phase !== "MARKET" && gameState?.current_phase !== "PITCHING") && (
          <div>
            <h2>{gameState?.current_phase === "SETUP" ? "Waiting for Game to Start" : "Prepare for next phase"}</h2>
            <p className="text-muted">Follow the instructions on the main display.</p>
          </div>
        )}

      </div>
    </div>
  );
}
