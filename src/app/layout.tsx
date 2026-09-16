import type { Metadata } from "next";
import { Rubik } from "next/font/google";
import "./globals.css";

const rubik = Rubik({ subsets: ["latin"], weight: ["400", "600", "800", "900"] });

import { Providers } from "@/components/Providers";

export const metadata: Metadata = {
  title: "Evolvia Market Place",
  description: "Space-themed market place game for Evolvia",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={rubik.className}>
        {/* Floating Crewmates Background */}
        <div className="space-bg">
          <div className="stars"></div>
          <div className="crewmate-float c1"></div>
          <div className="crewmate-float c2"></div>
          <div className="crewmate-float c3"></div>
          <div className="crewmate-float c4"></div>
        </div>
        
        <div className="app-container">
          <Providers>{children}</Providers>
        </div>
      </body>
    </html>
  );
}

