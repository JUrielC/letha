"use client";

import { useEffect } from "react";
import { getBaseUrl } from "@/lib/api";

export function KeepAlive() {
  useEffect(() => {
    const interval = setInterval(() => {
      fetch(`${getBaseUrl()}/api/health`).catch(() => {});
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  return null;
}
