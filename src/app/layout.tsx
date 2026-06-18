import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Agent Live Chat",
  description: "AI-first live chat with manual human takeover.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
