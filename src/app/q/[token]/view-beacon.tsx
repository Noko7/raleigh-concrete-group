"use client";

import { useEffect } from "react";

// Client-side so bot prefetches and link unfurlers don't inflate the count.
export function ViewBeacon({ token }: { token: string }) {
  useEffect(() => {
    const key = `cq_viewed_${token}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
    fetch("/api/track-view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
      keepalive: true,
    }).catch(() => {});
  }, [token]);
  return null;
}
