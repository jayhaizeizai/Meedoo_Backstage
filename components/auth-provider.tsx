"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { SocialPlatform } from "../lib/social-platforms";
import type { MeeDooUser } from "../lib/auth";

type AuthState = {
  enabledPlatforms: SocialPlatform[];
  configured: boolean;
  required: boolean;
  loading: boolean;
  user: MeeDooUser | null;
  role: "member" | "approver";
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [enabledPlatforms, setEnabledPlatforms] = useState<SocialPlatform[]>(
    [],
  );
  const [configured, setConfigured] = useState(false);
  const [required, setRequired] = useState(false);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<MeeDooUser | null>(null);
  const [role, setRole] = useState<"member" | "approver">("member");

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/me", { cache: "no-store" });
      const data = (await response.json()) as {
        enabledPlatforms?: SocialPlatform[];
        configured: boolean;
        required: boolean;
        user: MeeDooUser | null;
        role?: "member" | "approver";
      };
      setEnabledPlatforms(data.enabledPlatforms ?? []);
      setConfigured(data.configured);
      setRequired(data.required);
      setUser(data.user);
      setRole(data.role ?? "member");
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    window.location.assign("/login");
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({
      enabledPlatforms,
      configured,
      required,
      loading,
      user,
      role,
      refresh,
      logout,
    }),
    [
      enabledPlatforms,
      configured,
      required,
      loading,
      user,
      role,
      refresh,
      logout,
    ],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
