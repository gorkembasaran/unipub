"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { api, setStoredAuthToken } from "@/api";
import type { AuthUser } from "@/api";
import { useI18n } from "../i18n/I18nProvider";
import { getApiErrorMessage } from "../utils/apiErrors";

type AuthModalMode = "login" | "signup";

type AuthModalProps = {
  open: boolean;
  preferredMode?: AuthModalMode;
  title?: string;
  subtitle?: string;
  onClose: () => void;
  onSuccess?: (payload: { token: string; user: AuthUser }) => void;
};

export function AuthModal({
  open,
  preferredMode = "login",
  title,
  subtitle,
  onClose,
  onSuccess,
}: AuthModalProps) {
  const { t } = useI18n();
  const [mode, setMode] = useState<AuthModalMode>(preferredMode);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;

    setMode(preferredMode);
    setPassword("");
    setPasswordConfirm("");
    setError("");
  }, [open, preferredMode]);

  const modalTitle = useMemo(() => {
    if (title) return title;
    return mode === "login"
      ? t("home.auth.modal_login_title")
      : t("home.auth.modal_signup_title");
  }, [mode, t, title]);

  const modalSubtitle = useMemo(() => {
    if (subtitle) return subtitle;
    return mode === "login"
      ? t("home.auth.modal_login_sub")
      : t("home.auth.modal_signup_sub");
  }, [mode, subtitle, t]);

  if (!open) {
    return null;
  }

  const handleSubmit = async () => {
    setError("");

    if (!email.trim() || !password) {
      setError(t("home.auth.error.required"));
      return;
    }

    if (mode === "signup") {
      if (!fullName.trim()) {
        setError(t("home.auth.error.full_name_required"));
        return;
      }

      if (password.length < 6) {
        setError(t("home.auth.error.password_short"));
        return;
      }

      if (password !== passwordConfirm) {
        setError(t("home.auth.error.password_mismatch"));
        return;
      }
    }

    setLoading(true);

    try {
      const normalizedEmail = email.trim();
      const response =
        mode === "signup"
          ? await api.auth.register({
              fullName: fullName.trim(),
              email: normalizedEmail,
              password,
            })
          : await api.auth.login({
              email: normalizedEmail,
              password,
            });

      setStoredAuthToken(response.token);
      onSuccess?.(response);
      setFullName("");
      setEmail("");
      setPassword("");
      setPasswordConfirm("");
      setError("");
    } catch (submitError) {
      setError(getApiErrorMessage(submitError, t("home.auth.error.failed")));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-modal-backdrop" onClick={onClose}>
      <div
        className="auth-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="auth-modal-header">
          <div>
            <div className="auth-modal-title">{modalTitle}</div>
            <div className="auth-modal-subtitle">{modalSubtitle}</div>
          </div>
          <button
            type="button"
            className="auth-modal-close"
            onClick={onClose}
            aria-label={t("common.close")}
          >
            <X size={16} />
          </button>
        </div>

        <form
          className="auth-modal-form"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          {mode === "signup" ? (
            <label>
              {t("home.auth.full_name")}
              <input
                type="text"
                placeholder={t("home.auth.full_name_placeholder")}
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                autoComplete="name"
              />
            </label>
          ) : null}

          <label>
            {t("home.auth.email")}
            <input
              type="email"
              placeholder={t("home.auth.email_placeholder")}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
            />
          </label>

          <label>
            {t("home.auth.password")}
            <input
              type="password"
              placeholder={t("home.auth.password_placeholder")}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
          </label>

          {mode === "signup" ? (
            <label>
              {t("home.auth.password_confirm")}
              <input
                type="password"
                placeholder={t("home.auth.password_placeholder")}
                value={passwordConfirm}
                onChange={(event) => setPasswordConfirm(event.target.value)}
                autoComplete="new-password"
              />
            </label>
          ) : null}

          {error ? <div className="auth-modal-error">{error}</div> : null}

          <button type="submit" className="auth-modal-primary" disabled={loading}>
            {loading
              ? `${mode === "login" ? t("home.auth.login") : t("home.auth.signup")}...`
              : mode === "login"
                ? t("home.auth.login")
                : t("home.auth.signup")}
          </button>
        </form>

        <div className="auth-modal-footer">
          {mode === "login" ? (
            <button type="button" onClick={() => setMode("signup")}>
              {t("home.auth.switch_to_signup")}
            </button>
          ) : (
            <button type="button" onClick={() => setMode("login")}>
              {t("home.auth.switch_to_login")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
