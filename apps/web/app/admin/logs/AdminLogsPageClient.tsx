"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  Clock3,
  FileJson,
  ListFilter,
  LoaderCircle,
  Pin,
  RefreshCcw,
  Save,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Trash2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api, clearStoredAuthToken, getStoredAuthToken } from "@/api";
import type {
  AdminActivityLogDetail,
  AdminActivityLogListFilters,
  AdminActivityLogListItem,
  AdminActivityLogUpdatePayload,
  AuthUser,
} from "@/api";
import { AuthorPageTopbar } from "../../author/components/AuthorPageTopbar";
import { useI18n } from "../../i18n/I18nProvider";
import { useTheme } from "../../theme/ThemeProvider";
import { formatAdminCopy, getAdminCopy } from "../adminCopy";
import { AdminWorkspaceNav } from "../components/AdminWorkspaceNav";

type AuthState = "loading" | "unauthorized" | "forbidden" | "ready";
type SuccessFilterValue = "all" | "true" | "false";

type LogFilterState = {
  q: string;
  category: string;
  action: string;
  status: string;
  success: SuccessFilterValue;
  actorType: string;
  entityType: string;
  from: string;
  to: string;
  pageSize: number;
};

type LogEditorState = {
  action: string;
  category: string;
  adminStatus: string;
  tagsText: string;
  note: string;
  pinned: boolean;
  actorText: string;
  entityText: string;
  requestText: string;
  responseText: string;
  errorText: string;
  summaryText: string;
  metadataText: string;
};

type FeedbackState = {
  type: "success" | "error";
  text: string;
} | null;

const defaultFilters: LogFilterState = {
  q: "",
  category: "",
  action: "",
  status: "",
  success: "all",
  actorType: "",
  entityType: "",
  from: "",
  to: "",
  pageSize: 20,
};

function getErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  const normalized = error.message.replace(/^API error \d+:\s*/i, "").trim();
  return normalized || fallback;
}

function safeJsonStringify(value: unknown) {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return "{}";
  }
}

function splitCommaLines(value: string) {
  return Array.from(
    new Set(
      value
        .split(/\n|,/g)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function formatDateTime(locale: string, value?: string) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

function buildLogEditor(detail: AdminActivityLogDetail): LogEditorState {
  return {
    action: detail.action ?? "",
    category: detail.category ?? "",
    adminStatus: detail.admin?.status ?? "open",
    tagsText: (detail.admin?.tags ?? []).join(", "),
    note: detail.admin?.note ?? "",
    pinned: Boolean(detail.admin?.pinned),
    actorText: safeJsonStringify(detail.actor ?? {}),
    entityText: safeJsonStringify(detail.entity ?? {}),
    requestText: safeJsonStringify(detail.request ?? {}),
    responseText: safeJsonStringify(detail.response ?? {}),
    errorText: detail.error ? safeJsonStringify(detail.error) : "",
    summaryText: safeJsonStringify(detail.summary ?? {}),
    metadataText: safeJsonStringify(detail.metadata ?? {}),
  };
}

function parseRecordJson(
  value: string,
  fieldLabel: string,
  localeMessages: {
    invalidJsonObject: string;
    invalidJson: string;
  },
  options: { allowEmpty?: boolean; allowNull?: boolean } = {},
) {
  const { allowEmpty = true, allowNull = false } = options;
  const trimmed = value.trim();

  if (!trimmed) {
    if (allowNull) return null;
    if (allowEmpty) return {};
  }

  try {
    const parsed = JSON.parse(trimmed || "{}");
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error(formatAdminCopy(localeMessages.invalidJsonObject, { field: fieldLabel }));
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof Error && error.message.includes(fieldLabel)) {
      throw error;
    }

    throw new Error(
      formatAdminCopy(localeMessages.invalidJson, {
        field: fieldLabel,
        message: error instanceof Error ? error.message : "unknown",
      }),
    );
  }
}

function buildListFilters(filters: LogFilterState, page: number): AdminActivityLogListFilters {
  return {
    page,
    pageSize: filters.pageSize,
    category: filters.category.trim() || undefined,
    action: filters.action.trim() || undefined,
    status: filters.status.trim() || undefined,
    success: filters.success === "all" ? undefined : filters.success === "true",
    actorType: filters.actorType.trim() || undefined,
    entityType: filters.entityType.trim() || undefined,
    q: filters.q.trim() || undefined,
    from: filters.from || undefined,
    to: filters.to || undefined,
  };
}

function getLogPrimaryText(item: AdminActivityLogListItem) {
  return item.preview.title || item.action || item.preview.path || "Log";
}

function getLogSecondaryText(item: AdminActivityLogListItem, fallback: string) {
  return item.preview.subtitle || item.preview.query || item.preview.path || fallback;
}

function getObjectValue(detail: Record<string, unknown> | undefined, key: string) {
  if (!detail || typeof detail !== "object") return undefined;
  return detail[key];
}

function getActorLabel(detail: AdminActivityLogDetail | AdminActivityLogListItem | null | undefined, fallback: string) {
  const actor = detail?.actor;
  if (!actor || typeof actor !== "object") return fallback;
  const fullName = typeof actor.fullName === "string" ? actor.fullName : "";
  const email = typeof actor.email === "string" ? actor.email : "";
  const type = typeof actor.type === "string" ? actor.type : "";
  return fullName || email || type || fallback;
}

function getEntityLabel(detail: AdminActivityLogDetail | AdminActivityLogListItem | null | undefined, fallback: string) {
  const entity = detail?.entity;
  if (!entity || typeof entity !== "object") return fallback;
  const name = typeof entity.name === "string" ? entity.name : "";
  const id = typeof entity.id === "string" ? entity.id : "";
  const type = typeof entity.type === "string" ? entity.type : "";
  return name || id || type || fallback;
}

function getResponseStatusCode(detail?: AdminActivityLogDetail | null) {
  const value = getObjectValue(detail?.response as Record<string, unknown> | undefined, "statusCode");
  return typeof value === "number" ? value : null;
}

function getResponseDuration(detail?: AdminActivityLogDetail | null) {
  const value = getObjectValue(detail?.response as Record<string, unknown> | undefined, "durationMs");
  return typeof value === "number" ? value : null;
}

function SummaryCard(props: {
  icon: LucideIcon;
  label: string;
  value: string;
  note?: string;
  tone?: "default" | "warning" | "accent";
}) {
  const Icon = props.icon;
  const className = [
    "admin-summary-card",
    props.tone === "warning" ? "is-warning" : "",
    props.tone === "accent" ? "is-accent" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={className}>
      <div className="admin-summary-card-icon" aria-hidden="true">
        <Icon size={16} />
      </div>
      <div className="admin-summary-card-copy">
        <div className="admin-summary-card-label">{props.label}</div>
        <strong>{props.value}</strong>
        {props.note ? <p className="admin-summary-card-note">{props.note}</p> : null}
      </div>
    </div>
  );
}

function JsonEditorField(props: {
  label: string;
  value: string;
  rows: number;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="admin-field admin-field-full">
      <span>{props.label}</span>
      <textarea
        className="admin-json-input"
        rows={props.rows}
        value={props.value}
        placeholder={props.placeholder}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </label>
  );
}

export default function AdminLogsPageClient() {
  const router = useRouter();
  const { theme, toggle } = useTheme();
  const { locale, t } = useI18n();
  const copy = useMemo(() => getAdminCopy(locale), [locale]);
  const numberFormatter = useMemo(() => new Intl.NumberFormat(locale), [locale]);

  const [authState, setAuthState] = useState<AuthState>("loading");
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);

  const [filters, setFilters] = useState<LogFilterState>(defaultFilters);
  const [submittedFilters, setSubmittedFilters] = useState<LogFilterState>(defaultFilters);
  const [page, setPage] = useState(1);

  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [logsData, setLogsData] = useState<{
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    facets: {
      categories: Array<{ value: string; label: string; count: number }>;
      actions: Array<{ value: string; label: string; count: number }>;
      statuses: Array<{ value: string; label: string; count: number }>;
    };
    items: AdminActivityLogListItem[];
    fetchedAt: string;
  } | null>(null);

  const [selectedLogId, setSelectedLogId] = useState("");
  const [selectedLog, setSelectedLog] = useState<AdminActivityLogDetail | null>(null);
  const [logEditor, setLogEditor] = useState<LogEditorState | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [saveLoading, setSaveLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState>(null);

  useEffect(() => {
    let isMounted = true;
    const token = getStoredAuthToken();
    if (!token) {
      setAuthState("unauthorized");
      return;
    }

    api.auth
      .me(token)
      .then((response) => {
        if (!isMounted) return;
        setCurrentUser(response.user);
        setAuthState(response.user.isAdmin ? "ready" : "forbidden");
      })
      .catch(() => {
        if (!isMounted) return;
        clearStoredAuthToken();
        setCurrentUser(null);
        setAuthState("unauthorized");
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (authState !== "unauthorized" && authState !== "forbidden") return;

    const timeoutId = window.setTimeout(() => {
      router.replace("/admin");
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [authState, router]);

  const totalCountLabel = useMemo(() => {
    return formatAdminCopy(copy.logs.totalRecords, {
      count: numberFormatter.format(logsData?.total ?? 0),
    });
  }, [copy.logs.totalRecords, logsData?.total, numberFormatter]);

  const activeFilterCount = useMemo(() => {
    return [
      submittedFilters.q,
      submittedFilters.category,
      submittedFilters.action,
      submittedFilters.status,
      submittedFilters.actorType,
      submittedFilters.entityType,
      submittedFilters.from,
      submittedFilters.to,
      submittedFilters.success !== "all" ? submittedFilters.success : "",
    ].filter(Boolean).length;
  }, [submittedFilters]);

  const activeFilterSummary = useMemo(() => {
    if (activeFilterCount <= 0) return copy.logs.filtersSummaryIdle;
    return formatAdminCopy(copy.logs.filtersSummaryActive, {
      count: numberFormatter.format(activeFilterCount),
    });
  }, [
    activeFilterCount,
    copy.logs.filtersSummaryActive,
    copy.logs.filtersSummaryIdle,
    numberFormatter,
  ]);

  const selectedLogSummary = useMemo(() => {
    if (!selectedLog) return copy.logs.detailSummaryIdle;
    return getActorLabel(selectedLog, copy.logs.labels.anonymous);
  }, [copy.logs.detailSummaryIdle, copy.logs.labels.anonymous, selectedLog]);

  const overviewCards = useMemo(
    () => [
      {
        icon: ListFilter,
        label: copy.logs.listTitle,
        value: numberFormatter.format(logsData?.total ?? 0),
        note: totalCountLabel,
        tone: "accent" as const,
      },
      {
        icon: Search,
        label: copy.logs.filtersTitle,
        value: numberFormatter.format(activeFilterCount),
        note: activeFilterSummary,
      },
      {
        icon: Pin,
        label: copy.logs.detailTitle,
        value: selectedLogId ? getResponseStatusCode(selectedLog)?.toString() ?? selectedLogId.slice(-6) : "0",
        note: selectedLogSummary,
        tone: selectedLog?.admin?.pinned ? ("warning" as const) : ("default" as const),
      },
    ],
    [
      activeFilterCount,
      copy.logs.detailTitle,
      copy.logs.filtersTitle,
      copy.logs.listTitle,
      activeFilterSummary,
      logsData?.total,
      numberFormatter,
      selectedLog,
      selectedLogId,
      selectedLogSummary,
      totalCountLabel,
    ],
  );

  const loadLogs = async (nextPage = page, nextFilters = submittedFilters) => {
    setLogsLoading(true);
    setLogsError(null);

    try {
      const response = await api.admin.listActivityLogs(buildListFilters(nextFilters, nextPage));

      setLogsData(response);
      setSelectedLogId((current) => {
        const exists = response.items.some((item) => item.id === current);
        return exists ? current : response.items[0]?.id ?? "";
      });
    } catch (error) {
      setLogsError(getErrorMessage(error, copy.logs.messages.listFailed));
      setLogsData(null);
      setSelectedLogId("");
    } finally {
      setLogsLoading(false);
    }
  };

  const loadLogDetail = async (logId: string) => {
    if (!logId) {
      setSelectedLog(null);
      setLogEditor(null);
      return;
    }

    setDetailLoading(true);
    setDetailError(null);

    try {
      const detail = await api.admin.getActivityLog(logId);
      setSelectedLog(detail);
      setLogEditor(buildLogEditor(detail));
    } catch (error) {
      setDetailError(getErrorMessage(error, copy.logs.messages.detailFailed));
      setSelectedLog(null);
      setLogEditor(null);
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => {
    if (authState !== "ready") return;
    void loadLogs(page, submittedFilters);
  }, [authState, page, submittedFilters]);

  useEffect(() => {
    if (authState !== "ready") return;
    if (!selectedLogId) {
      setSelectedLog(null);
      setLogEditor(null);
      return;
    }
    void loadLogDetail(selectedLogId);
  }, [authState, selectedLogId]);

  const handleApplyFilters = () => {
    setFeedback(null);
    setPage(1);
    setSubmittedFilters({ ...filters });
  };

  const handleResetFilters = () => {
    setFeedback(null);
    setFilters(defaultFilters);
    setSubmittedFilters(defaultFilters);
    setPage(1);
  };

  const handleSaveLog = async () => {
    if (!selectedLog || !logEditor) return;

    setSaveLoading(true);
    setFeedback(null);

    try {
      const payload: AdminActivityLogUpdatePayload = {
        action: logEditor.action.trim() || undefined,
        category: logEditor.category.trim() || undefined,
        actor: parseRecordJson(logEditor.actorText, copy.logs.rawFields.actor, copy.logs.messages) as Record<
          string,
          unknown
        >,
        entity: parseRecordJson(logEditor.entityText, copy.logs.rawFields.entity, copy.logs.messages) as Record<
          string,
          unknown
        >,
        request: parseRecordJson(logEditor.requestText, copy.logs.rawFields.request, copy.logs.messages) as Record<
          string,
          unknown
        >,
        response: parseRecordJson(logEditor.responseText, copy.logs.rawFields.response, copy.logs.messages) as Record<
          string,
          unknown
        >,
        error: parseRecordJson(logEditor.errorText, copy.logs.rawFields.error, copy.logs.messages, {
          allowNull: true,
        }) as Record<string, unknown> | null,
        summary: parseRecordJson(logEditor.summaryText, copy.logs.rawFields.summary, copy.logs.messages) as Record<
          string,
          unknown
        >,
        metadata: parseRecordJson(logEditor.metadataText, copy.logs.rawFields.metadata, copy.logs.messages) as Record<
          string,
          unknown
        >,
        admin: {
          status: logEditor.adminStatus.trim() || "open",
          tags: splitCommaLines(logEditor.tagsText),
          note: logEditor.note.trim(),
          pinned: logEditor.pinned,
        },
      };

      const updated = await api.admin.updateActivityLog(selectedLog.id, payload);
      setSelectedLog(updated);
      setLogEditor(buildLogEditor(updated));
      setFeedback({ type: "success", text: copy.logs.messages.updated });
      await loadLogs();
    } catch (error) {
      setFeedback({
        type: "error",
        text: getErrorMessage(error, copy.logs.messages.updateFailed),
      });
    } finally {
      setSaveLoading(false);
    }
  };

  const handleDeleteLog = async () => {
    if (!selectedLog) return;
    if (!window.confirm(copy.logs.deleteConfirm)) {
      return;
    }

    setDeleteLoading(true);
    setFeedback(null);

    try {
      await api.admin.deleteActivityLog(selectedLog.id);
      setFeedback({ type: "success", text: copy.logs.messages.deleted });
      setSelectedLog(null);
      setLogEditor(null);
      setSelectedLogId("");

      if ((logsData?.items.length ?? 0) === 1 && page > 1) {
        setPage((current) => Math.max(1, current - 1));
      } else {
        await loadLogs();
      }
    } catch (error) {
      setFeedback({
        type: "error",
        text: getErrorMessage(error, copy.logs.messages.deleteFailed),
      });
    } finally {
      setDeleteLoading(false);
    }
  };

  const adminBrandName = `${t("brand.name")} Admin`;
  const currentUserLabel =
    currentUser?.fullName ?? currentUser?.email ?? copy.logs.labels.unknownUser;
  const currentRangeLabel =
    (logsData?.total ?? 0) === 0
      ? copy.logs.rangeEmpty
      : formatAdminCopy(copy.logs.rangeLabel, {
          from: numberFormatter.format((page - 1) * (logsData?.pageSize ?? submittedFilters.pageSize) + 1),
          to: numberFormatter.format(
            Math.min(page * (logsData?.pageSize ?? submittedFilters.pageSize), logsData?.total ?? 0),
          ),
          total: numberFormatter.format(logsData?.total ?? 0),
        });

  if (authState === "loading") {
    return (
      <main className="authors-page admin-page">
        <div className="authors-shell">
          <AuthorPageTopbar
            backHref="/admin"
            backLabel={copy.logs.backLabel}
            brandName={adminBrandName}
            brandSubtitle={copy.logs.topbarSubtitle}
            theme={theme}
            themeToggleLabel={t("theme.toggle")}
            onToggleTheme={toggle}
          />
          <section className="admin-status-card">
            <LoaderCircle size={18} className="is-spinning" />
            <div>{copy.logs.loadingSession}</div>
          </section>
        </div>
      </main>
    );
  }

  if (authState === "unauthorized") {
    return (
      <main className="authors-page admin-page">
        <div className="authors-shell">
          <AuthorPageTopbar
            backHref="/admin"
            backLabel={copy.logs.backLabel}
            brandName={adminBrandName}
            brandSubtitle={copy.logs.topbarSubtitle}
            theme={theme}
            themeToggleLabel={t("theme.toggle")}
            onToggleTheme={toggle}
          />
          <section className="admin-status-card is-warning">
            <ShieldAlert size={20} />
            <div>
              <strong>{copy.logs.unauthorizedTitle}</strong>
              <p>{copy.logs.unauthorizedBody}</p>
            </div>
          </section>
        </div>
      </main>
    );
  }

  if (authState === "forbidden") {
    return (
      <main className="authors-page admin-page">
        <div className="authors-shell">
          <AuthorPageTopbar
            backHref="/admin"
            backLabel={copy.logs.backLabel}
            brandName={adminBrandName}
            brandSubtitle={copy.logs.topbarSubtitle}
            theme={theme}
            themeToggleLabel={t("theme.toggle")}
            onToggleTheme={toggle}
          />
          <section className="admin-status-card is-danger">
            <ShieldX size={20} />
            <div>
              <strong>{copy.logs.forbiddenTitle}</strong>
              <p>{currentUser?.email ?? copy.logs.labels.unknownUser}</p>
            </div>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="authors-page admin-page">
      <div className="authors-shell">
        <AuthorPageTopbar
          backHref="/admin"
          backLabel={copy.logs.backLabel}
          brandName={adminBrandName}
          brandSubtitle={copy.logs.topbarSubtitle}
          theme={theme}
          themeToggleLabel={t("theme.toggle")}
          onToggleTheme={toggle}
        />
        <AdminWorkspaceNav />

        {feedback ? (
          <section
            className={
              feedback.type === "success"
                ? "admin-feedback-card is-success"
                : "admin-feedback-card is-error"
            }
          >
            {feedback.text}
          </section>
        ) : null}

        <section className="admin-search-card admin-search-card-logs">
          <div className="admin-search-head admin-search-head-logs">
            <div>
              <h2>{copy.logs.filtersTitle}</h2>
              <p>{copy.logs.filtersSubtitle}</p>
            </div>
            <div className="admin-search-note admin-search-note-logs">
              <strong>{totalCountLabel}</strong>
              {logsData?.fetchedAt ? (
                <span>
                  {formatAdminCopy(copy.logs.fetchedAt, {
                    date: formatDateTime(locale, logsData.fetchedAt),
                  })}
                </span>
              ) : null}
            </div>
          </div>

          <form
            className="admin-filter-grid admin-filter-grid-logs"
            onSubmit={(event) => {
              event.preventDefault();
              handleApplyFilters();
            }}
          >
            <div className="admin-field admin-field-full">
              <div className="admin-field-topline">
                <span>{copy.logs.searchLabel}</span>
                <span className="admin-mini-pill">{activeFilterSummary}</span>
              </div>
              <div className="admin-searchbar admin-searchbar-logs">
                <label className="authors-search-input">
                  <Search size={18} />
                  <input
                    value={filters.q}
                    onChange={(event) =>
                      setFilters((current) => ({ ...current, q: event.target.value }))
                    }
                    placeholder={copy.logs.searchPlaceholder}
                  />
                </label>
                <div className="admin-searchbar-actions">
                  <button
                    type="button"
                    className="admin-secondary-button admin-secondary-button-quiet"
                    onClick={handleResetFilters}
                  >
                    {copy.logs.clearAction}
                  </button>
                  <button
                    type="button"
                    className="admin-secondary-button admin-secondary-button-quiet"
                    onClick={() => void loadLogs()}
                    disabled={logsLoading}
                  >
                    <RefreshCcw size={15} />
                    {copy.logs.refreshAction}
                  </button>
                  <button
                    type="submit"
                    className="admin-primary-button admin-primary-button-compact admin-search-submit"
                    disabled={logsLoading}
                  >
                    {logsLoading ? copy.logs.filterActionLoading : copy.logs.filterAction}
                  </button>
                </div>
              </div>
            </div>

            <label className="admin-field">
              <span>{copy.logs.category}</span>
              <select
                className="admin-select"
                value={filters.category}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, category: event.target.value }))
                }
              >
                <option value="">{copy.logs.all}</option>
                {(logsData?.facets.categories ?? []).map((facet) => (
                  <option key={facet.value} value={facet.value}>
                    {facet.label} ({facet.count})
                  </option>
                ))}
              </select>
            </label>

            <label className="admin-field">
              <span>{copy.logs.action}</span>
              <select
                className="admin-select"
                value={filters.action}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, action: event.target.value }))
                }
              >
                <option value="">{copy.logs.all}</option>
                {(logsData?.facets.actions ?? []).map((facet) => (
                  <option key={facet.value} value={facet.value}>
                    {facet.label} ({facet.count})
                  </option>
                ))}
              </select>
            </label>

            <label className="admin-field">
              <span>{copy.logs.status}</span>
              <select
                className="admin-select"
                value={filters.status}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, status: event.target.value }))
                }
              >
                <option value="">{copy.logs.all}</option>
                {(logsData?.facets.statuses ?? []).map((facet) => (
                  <option key={facet.value} value={facet.value}>
                    {facet.label} ({facet.count})
                  </option>
                ))}
              </select>
            </label>

            <label className="admin-field">
              <span>{copy.logs.result}</span>
              <select
                className="admin-select"
                value={filters.success}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    success: event.target.value as SuccessFilterValue,
                  }))
                }
              >
                <option value="all">{copy.logs.all}</option>
                <option value="true">{copy.logs.success}</option>
                <option value="false">{copy.logs.failure}</option>
              </select>
            </label>

            <label className="admin-field">
              <span>{copy.logs.actorType}</span>
              <input
                className="admin-input"
                value={filters.actorType}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, actorType: event.target.value }))
                }
                placeholder="authenticated_user"
              />
            </label>

            <label className="admin-field">
              <span>{copy.logs.entityType}</span>
              <input
                className="admin-input"
                value={filters.entityType}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, entityType: event.target.value }))
                }
                placeholder="author / publication"
              />
            </label>

            <label className="admin-field admin-date-field">
              <span>{copy.logs.from}</span>
              <div className="admin-input-with-icon admin-input-with-icon-date">
                <CalendarDays size={16} />
                <input
                  className="admin-input admin-input-date"
                  type="date"
                  value={filters.from}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, from: event.target.value }))
                  }
                />
              </div>
            </label>

            <label className="admin-field admin-date-field">
              <span>{copy.logs.to}</span>
              <div className="admin-input-with-icon admin-input-with-icon-date">
                <Clock3 size={16} />
                <input
                  className="admin-input admin-input-date"
                  type="date"
                  value={filters.to}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, to: event.target.value }))
                  }
                />
              </div>
            </label>

            <label className="admin-field">
              <span>{copy.logs.pageSize}</span>
              <select
                className="admin-select"
                value={String(filters.pageSize)}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    pageSize: Number(event.target.value),
                  }))
                }
              >
                {[10, 20, 50, 100].map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>

          </form>
        </section>

        <section className="admin-grid">
          <div className="admin-panel">
            <div className="admin-panel-head">
              <div>
                <h2>{copy.logs.listTitle}</h2>
                <p className="admin-panel-head-copy">
                  {formatAdminCopy(copy.logs.listPage, {
                    page: numberFormatter.format(logsData?.page ?? page),
                    total: numberFormatter.format(Math.max(logsData?.totalPages ?? 1, 1)),
                  })}
                </p>
              </div>
              <span>{currentRangeLabel}</span>
            </div>

            {logsError ? <div className="admin-empty-card">{logsError}</div> : null}

            <div className="admin-results-list">
              {logsLoading && !logsData ? (
                <div className="admin-empty-card">{copy.logs.listLoading}</div>
              ) : (logsData?.items.length ?? 0) === 0 ? (
                <div className="admin-empty-card">{copy.logs.listEmpty}</div>
              ) : (
                (logsData?.items ?? []).map((item) => {
                  const isActive = item.id === selectedLogId;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={isActive ? "admin-result-card admin-log-card is-active" : "admin-result-card admin-log-card"}
                      onClick={() => {
                        setFeedback(null);
                        setSelectedLogId(item.id);
                      }}
                    >
                      <div className="admin-log-preview-row">
                        <strong>{getLogPrimaryText(item)}</strong>
                        <div className="admin-log-badges">
                          {item.admin.pinned ? (
                            <span className="admin-pill is-warning">
                              <Pin size={12} />
                              {copy.logs.pinnedLabel}
                            </span>
                          ) : null}
                          <span className="admin-pill">{item.category}</span>
                          <span className={item.response.success ? "admin-mini-pill is-success" : "admin-mini-pill is-danger"}>
                            {item.response.success ? copy.logs.success : copy.logs.failure}
                          </span>
                        </div>
                      </div>
                      <div className="admin-result-meta">
                        {getLogSecondaryText(item, copy.logs.labels.pathUnavailable)}
                      </div>
                      <div className="admin-log-preview-meta">
                        <span>{item.action}</span>
                        <span>{item.response.statusCode}</span>
                        <span>{item.response.durationMs} ms</span>
                        <span>{formatDateTime(locale, item.createdAt)}</span>
                      </div>
                      <div className="admin-log-preview-meta">
                        <span>{getActorLabel(item, copy.logs.labels.anonymous)}</span>
                        <span>{getEntityLabel(item, copy.logs.labels.noEntity)}</span>
                        {item.preview.path ? <span>{item.preview.path}</span> : null}
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            <div className="admin-pagination">
              <button
                type="button"
                className="admin-secondary-button"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page <= 1 || logsLoading}
              >
                {copy.logs.previous}
              </button>
              <span>{currentRangeLabel}</span>
              <button
                type="button"
                className="admin-secondary-button"
                onClick={() =>
                  setPage((current) => Math.min(current + 1, Math.max(logsData?.totalPages ?? 1, 1)))
                }
                disabled={page >= (logsData?.totalPages ?? 1) || logsLoading}
              >
                {copy.logs.next}
              </button>
            </div>
          </div>

          <div className="admin-panel admin-panel-wide">
            <div className="admin-panel-head">
              <div>
                <h2>{copy.logs.detailTitle}</h2>
                <p className="admin-panel-head-copy">{selectedLog?.id ?? copy.logs.labels.noSelection}</p>
              </div>
              <span>{selectedLog?.requestId ?? copy.logs.labels.noSelection}</span>
            </div>

            {detailError ? <div className="admin-empty-card">{detailError}</div> : null}

            {detailLoading ? (
              <div className="admin-empty-card">{copy.logs.detailLoading}</div>
            ) : !selectedLog || !logEditor ? (
              <div className="admin-empty-card">{copy.logs.detailEmpty}</div>
            ) : (
              <div className="admin-detail-stack">
                <section className="admin-workspace-hero">
                  <div className="admin-workspace-copy">
                    <p className="admin-eyebrow">{copy.logs.overviewTitle}</p>
                    <h2>{selectedLog.action || selectedLog.id}</h2>
                    <div className="admin-inline-list">
                      <span>{selectedLog.category || copy.logs.category}</span>
                      <span>{getActorLabel(selectedLog, copy.logs.labels.anonymous)}</span>
                      <span>{getEntityLabel(selectedLog, copy.logs.labels.noEntity)}</span>
                    </div>
                    <div className="admin-result-preview admin-result-preview-tight">
                      <span>{selectedLog.id}</span>
                      {selectedLog.requestId ? <span>{selectedLog.requestId}</span> : null}
                      {selectedLog.admin?.status ? <span>{selectedLog.admin.status}</span> : null}
                    </div>
                  </div>
                  <div className="admin-action-row admin-action-row-compact">
                    <button
                      type="button"
                      className="admin-primary-button"
                      onClick={() => void handleSaveLog()}
                      disabled={saveLoading}
                    >
                      <Save size={15} />
                      {saveLoading ? copy.logs.saveActionLoading : copy.logs.saveAction}
                    </button>
                    <button
                      type="button"
                      className="admin-secondary-button"
                      onClick={() => void loadLogDetail(selectedLog.id)}
                      disabled={detailLoading}
                    >
                      <RefreshCcw size={15} />
                      {copy.logs.refreshDetailAction}
                    </button>
                    <button
                      type="button"
                      className="admin-secondary-button is-danger"
                      onClick={() => void handleDeleteLog()}
                      disabled={deleteLoading}
                    >
                      <Trash2 size={15} />
                      {deleteLoading ? copy.logs.deleteActionLoading : copy.logs.deleteAction}
                    </button>
                  </div>
                </section>

                <section className="admin-summary-grid admin-summary-grid-3">
                  <SummaryCard
                    icon={Search}
                    label={copy.logs.requestId}
                    value={selectedLog.requestId ?? "-"}
                    note={copy.logs.overviewTitle}
                    tone="accent"
                  />
                  <SummaryCard
                    icon={CalendarDays}
                    label={copy.logs.createdAt}
                    value={formatDateTime(locale, selectedLog.createdAt)}
                    note={copy.logs.updatedAt}
                  />
                  <SummaryCard
                    icon={Clock3}
                    label={copy.logs.updatedAt}
                    value={formatDateTime(locale, selectedLog.updatedAt)}
                    note={copy.logs.moderationSubtitle}
                  />
                  <SummaryCard
                    icon={ShieldCheck}
                    label={copy.logs.statusCode}
                    value={String(getResponseStatusCode(selectedLog) ?? "-")}
                    note={copy.logs.result}
                    tone={getResponseStatusCode(selectedLog) && (getResponseStatusCode(selectedLog) ?? 0) >= 400 ? "warning" : "default"}
                  />
                  <SummaryCard
                    icon={Clock3}
                    label={copy.logs.duration}
                    value={
                      getResponseDuration(selectedLog) !== null
                        ? `${numberFormatter.format(getResponseDuration(selectedLog) ?? 0)} ms`
                        : "-"
                    }
                    note={selectedLog.admin?.status ?? logEditor.adminStatus}
                  />
                  <SummaryCard
                    icon={Pin}
                    label={copy.logs.tags}
                    value={numberFormatter.format(selectedLog.admin?.tags?.length ?? 0)}
                    note={logEditor.pinned ? copy.logs.pinnedLabel : copy.logs.pinBody}
                    tone={logEditor.pinned ? "warning" : "default"}
                  />
                </section>

                <section className="admin-detail-card">
                  <div className="admin-section-head">
                    <div>
                      <h3>{copy.logs.moderationTitle}</h3>
                      <p className="admin-panel-head-copy">{copy.logs.moderationSubtitle}</p>
                    </div>
                  </div>

                  <div className="admin-form-grid">
                    <label className="admin-field">
                      <span>{copy.logs.action}</span>
                      <input
                        value={logEditor.action}
                        onChange={(event) =>
                          setLogEditor((current) =>
                            current ? { ...current, action: event.target.value } : current,
                          )
                        }
                      />
                    </label>
                    <label className="admin-field">
                      <span>{copy.logs.category}</span>
                      <input
                        value={logEditor.category}
                        onChange={(event) =>
                          setLogEditor((current) =>
                            current ? { ...current, category: event.target.value } : current,
                          )
                        }
                      />
                    </label>
                    <label className="admin-field">
                      <span>{copy.logs.adminStatus}</span>
                      <input
                        value={logEditor.adminStatus}
                        onChange={(event) =>
                          setLogEditor((current) =>
                            current ? { ...current, adminStatus: event.target.value } : current,
                          )
                        }
                        placeholder={copy.logs.adminStatusPlaceholder}
                      />
                    </label>
                    <label className="admin-field">
                      <span>{copy.logs.tags}</span>
                      <input
                        value={logEditor.tagsText}
                        onChange={(event) =>
                          setLogEditor((current) =>
                            current ? { ...current, tagsText: event.target.value } : current,
                          )
                        }
                        placeholder={copy.logs.tagsPlaceholder}
                      />
                    </label>
                    <label className="admin-field admin-field-full">
                      <span>{copy.logs.note}</span>
                      <textarea
                        rows={3}
                        value={logEditor.note}
                        onChange={(event) =>
                          setLogEditor((current) =>
                            current ? { ...current, note: event.target.value } : current,
                          )
                        }
                      />
                    </label>
                    <label className="admin-checkbox-main admin-field-full">
                      <input
                        type="checkbox"
                        checked={logEditor.pinned}
                        onChange={(event) =>
                          setLogEditor((current) =>
                            current ? { ...current, pinned: event.target.checked } : current,
                          )
                        }
                      />
                      <div>
                        <strong>{copy.logs.pinTitle}</strong>
                        <div className="admin-subtle-text">{copy.logs.pinBody}</div>
                      </div>
                    </label>
                  </div>
                </section>

                <section className="admin-detail-card">
                  <div className="admin-section-head">
                    <div>
                      <h3>{copy.logs.rawTitle}</h3>
                      <p className="admin-panel-head-copy">{copy.logs.rawSubtitle}</p>
                    </div>
                  </div>
                  <div className="admin-form-grid">
                    <JsonEditorField
                      label={copy.logs.rawFields.actor}
                      value={logEditor.actorText}
                      rows={8}
                      onChange={(value) =>
                        setLogEditor((current) => (current ? { ...current, actorText: value } : current))
                      }
                    />
                    <JsonEditorField
                      label={copy.logs.rawFields.entity}
                      value={logEditor.entityText}
                      rows={8}
                      onChange={(value) =>
                        setLogEditor((current) => (current ? { ...current, entityText: value } : current))
                      }
                    />
                    <JsonEditorField
                      label={copy.logs.rawFields.request}
                      value={logEditor.requestText}
                      rows={10}
                      onChange={(value) =>
                        setLogEditor((current) => (current ? { ...current, requestText: value } : current))
                      }
                    />
                    <JsonEditorField
                      label={copy.logs.rawFields.response}
                      value={logEditor.responseText}
                      rows={8}
                      onChange={(value) =>
                        setLogEditor((current) => (current ? { ...current, responseText: value } : current))
                      }
                    />
                    <JsonEditorField
                      label={copy.logs.rawFields.error}
                      value={logEditor.errorText}
                      rows={6}
                      placeholder={copy.logs.rawFields.errorPlaceholder}
                      onChange={(value) =>
                        setLogEditor((current) => (current ? { ...current, errorText: value } : current))
                      }
                    />
                    <JsonEditorField
                      label={copy.logs.rawFields.summary}
                      value={logEditor.summaryText}
                      rows={8}
                      onChange={(value) =>
                        setLogEditor((current) => (current ? { ...current, summaryText: value } : current))
                      }
                    />
                    <JsonEditorField
                      label={copy.logs.rawFields.metadata}
                      value={logEditor.metadataText}
                      rows={8}
                      onChange={(value) =>
                        setLogEditor((current) => (current ? { ...current, metadataText: value } : current))
                      }
                    />
                  </div>
                </section>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
