import { apiRequest } from "../client";

export type AuthUser = {
  _id: string;
  fullName: string;
  email: string;
  isAdmin?: boolean;
};

export type AuthResponse = {
  token: string;
  user: AuthUser;
};

export const authApi = {
  register: (payload: { fullName: string; email: string; password: string }) =>
    apiRequest<AuthResponse>("/auth/register", { method: "POST", body: payload }),
  login: (payload: { email: string; password: string }) =>
    apiRequest<AuthResponse>("/auth/login", { method: "POST", body: payload }),
  me: (token: string) =>
    apiRequest<{ user: AuthUser }>("/auth/me", {
      authToken: token,
    }),
};
