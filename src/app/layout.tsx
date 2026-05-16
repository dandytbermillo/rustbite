import type { Metadata } from "next";
import "./globals.css";
import ObservabilityBootstrap from "@/components/observability-bootstrap";

export const metadata: Metadata = {
  title: "Rushbite Kiosk",
  description: "Hot. Fresh. Fast. Self-order kiosk for Rushbite.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <ObservabilityBootstrap />
        {children}
      </body>
    </html>
  );
}
