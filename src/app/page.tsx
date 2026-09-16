import Link from "next/link";
import { Rocket, ShieldAlert, Timer } from "lucide-react";

export default function Home() {
  return (
    <div className="flex-center" style={{ minHeight: "100vh", padding: "2rem" }}>
      <div className="glass-panel text-center" style={{ maxWidth: "600px", width: "100%" }}>
        <h1>Evolvia Market Place</h1>
        <p className="text-muted" style={{ marginBottom: "3rem", fontSize: "1.2rem" }}>
          Welcome to the intergalactic trading hub. Select your interface below.
        </p>

        <div style={{ display: "flex", justifyContent: "center" }}>
          <Link href="/leader" style={{ textDecoration: "none", width: "100%", maxWidth: "300px" }}>
            <div className="glass-panel flex-center" style={{ flexDirection: "column", gap: "1rem", cursor: "pointer", height: "100%", padding: "2rem" }}>
              <Rocket size={64} className="text-cyan" />
              <h2>Player Leader</h2>
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
}
