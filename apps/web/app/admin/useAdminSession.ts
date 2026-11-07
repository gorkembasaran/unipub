"use client";

import { useCallback, useEffect, useState } from "react";
import { api, clearStoredAuthToken, getStoredAuthToken } from "@/api";
import type { AuthUser } from "@/api";

export type AdminAuthState = "loading" | "unauthorized" | "forbidden" | "ready";

export function useAdminSession() {
  const [authState, setAuthState] = useState<AdminAuthState>("loading");
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);

  const refreshSession = useCallback(async (preferredToken?: string | null) => {
    const token =
      preferredToken === undefined ? getStoredAuthToken() : preferredToken;

    if (!token) {
      setCurrentUser(null);
      setAuthState("unauthorized");
      return null;
    }

    setAuthState("loading");

    try {
      const response = await api.auth.me(token);
      setCurrentUser(response.user);
      setAuthState(response.user.isAdmin ? "ready" : "forbidden");
      return response.user;
    } catch {
      clearStoredAuthToken();
      setCurrentUser(null);
      setAuthState("unauthorized");
      return null;
    }
  }, []);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  return { authState, currentUser, refreshSession };
}
