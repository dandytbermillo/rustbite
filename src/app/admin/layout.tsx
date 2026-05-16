import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Rushbite Admin",
  description: "Internal admin for Rushbite kiosk.",
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
