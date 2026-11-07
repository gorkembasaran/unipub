"use client";

import { useCallback, useEffect, useState } from "react";
import { api, clearStoredAuthToken, getStoredAuthToken } from "@/api";
import type { AuthUser } from "@/api";

export type AuthSessionState = "loading" | "anonymous" | "authenticated";

export function useAuthSession() {
  const [authState, setAuthState] = useState<AuthSessionState>("loading");
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);

  const refreshSession = useCallback(async (preferredToken?: string | null) => {
    const token =
      preferredToken === undefined ? getStoredAuthToken() : preferredToken;

    if (!token) {
      setCurrentUser(null);
      setAuthState("anonymous");
      return null;
    }

    setAuthState("loading");

    try {
      const response = await api.auth.me(token);
      setCurrentUser(response.user);
      setAuthState("authenticated");
      return response.user;
    } catch {
      clearStoredAuthToken();
      setCurrentUser(null);
      setAuthState("anonymous");
      return null;
    }
  }, []);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  return {
    authState,
    currentUser,
    isAuthenticated: authState === "authenticated",
    refreshSession,
  };
}
