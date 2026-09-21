import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Architect Hackathon",
  description: "Local AI software-development control center",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
