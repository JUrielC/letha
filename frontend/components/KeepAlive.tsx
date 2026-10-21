"use client";

import { useEffect } from "react";
import { getBaseUrl } from "@/lib/api";

export function KeepAlive() {
  useEffect(() => {
    const ping = () => {
      fetch(`${getBaseUrl()}/api/health`).catch(() => {});
    };

    const interval = setInterval(ping, 15000);
    window.addEventListener("focus", ping);
    document.addEventListener("visibilitychange", ping);

    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", ping);
      document.removeEventListener("visibilitychange", ping);
    };
  }, []);

  return null;
}
