"use client";
import { useEffect, useState } from "react";
import type { ConnectionState } from "./upload-model";
export function usePlatformConnection(user: unknown) {
  const [connection, setConnection] = useState<ConnectionState | null>(null);
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void fetch("/api/upload-post/profile", { cache: "no-store" })
      .then(async (response) => ({
        response,
        data: (await response.json()) as ConnectionState,
      }))
      .then(({ data }) => {
        if (cancelled) return;
        setConnection(data);
      })
      .catch(() => {
        if (!cancelled)
          setConnection({
            configured: false,
            connected: {},
            message: "Upload-Post unavailable",
          });
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  return connection;
}
