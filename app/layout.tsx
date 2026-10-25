import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ship Easy — shipment booking & pre-flight checker",
  description: "Book UK to Germany, France and Netherlands shipments and catch mistakes before they leave.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
