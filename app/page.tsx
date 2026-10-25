"use client";
import { useEffect, useState } from "react";
import App from "@/components/App";
import { londonToday } from "@/lib/dates";

export default function Home() {
  // "today" is the live Europe/London date, read once on the client and injected into the engine.
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => {
    setToday(londonToday(new Date()));
  }, []);
  if (!today) return <main className="min-h-screen" />;
  return <App today={today} />;
}
