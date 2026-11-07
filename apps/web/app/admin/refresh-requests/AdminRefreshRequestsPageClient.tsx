"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Clock3,
  RefreshCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  api,
  getStoredAuthToken,
  type AdminActivityLogDetail,
  type AdminActivityLogListItem,
} from "@/api";
import { AuthorPageTopbar } from "../../author/components/AuthorPageTopbar";
import { useI18n } from "../../i18n/I18nProvider";
import { useTheme } from "../../theme/ThemeProvider";
import { getApiErrorMessage } from "../../utils/apiErrors";
import { getAdminCopy } from "../adminCopy";
import { AdminWorkspaceNav } from "../components/AdminWorkspaceNav";
import { useAdminSession } from "../useAdminSession";

type RequestState = "pending" | "resolved" | "dismissed";
type FeedbackState = {
  text: string;
  type: "error" | "success";
} | null;

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

function getRecordString(source: Record<string, unknown> | undefined, key: string) {
  const value = source?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function getRequestState(status?: string | null): RequestState {
  const normalized = status?.trim().toLowerCase() ?? "";

  if (["resolved", "approved", "done", "closed"].includes(normalized)) {
    return "resolved";
  }

  if (["dismissed", "rejected", "ignored", "cancelled"].includes(normalized)) {
    return "dismissed";
  }

  return "pending";
}

function normalizeSearchText(value: string) {
  return value.trim().toLocaleLowerCase("tr-TR");
}

function isRefreshRequestItem(item: AdminActivityLogListItem) {
  const haystack = [
    item.action,
    item.category,
    item.preview.title,
    item.preview.subtitle,
    item.preview.path,
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("tr-TR");

  return (
    haystack.includes("refresh-request") ||
    haystack.includes("refresh request") ||
    haystack.includes("yenileme") ||
    haystack.includes("refresh")
  );
}

function matchesQuery(item: AdminActivityLogListItem, query: string) {
  if (!query) return true;

  const haystack = [
    item.requestId,
    item.preview.title,
    item.preview.subtitle,
    item.preview.path,
    item.action,
    item.category,
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("tr-TR");

  return haystack.includes(query);
}

function getRequestLogId(item: AdminActivityLogListItem | null) {
  return item?.id?.trim() || "";
}

function getRequestSelectionKey(item: AdminActivityLogListItem | null) {
  return (
    getRequestLogId(item) ||
    item?.requestId?.trim() ||
    [item?.createdAt?.trim(), item?.preview.title?.trim()].filter(Boolean).join("::")
  );
}

function extractRequestPath(
  item: AdminActivityLogListItem | null,
  detail: AdminActivityLogDetail | null,
) {
  const requestRecord =
    detail?.request && typeof detail.request === "object"
      ? (detail.request as Record<string, unknown>)
      : undefined;

  return (
    getRecordString(requestRecord, "path") ||
    item?.preview.path?.trim() ||
    ""
  );
}

function extractAuthorId(
  item: AdminActivityLogListItem | null,
  detail: AdminActivityLogDetail | null,
) {
  const entity =
    detail?.entity && typeof detail.entity === "object"
      ? (detail.entity as Record<string, unknown>)
      : item?.entity && typeof item.entity === "object"
        ? (item.entity as Record<string, unknown>)
        : undefined;
  const summary =
    detail?.summary && typeof detail.summary === "object"
      ? (detail.summary as Record<string, unknown>)
      : undefined;
  const metadata =
    detail?.metadata && typeof detail.metadata === "object"
      ? (detail.metadata as Record<string, unknown>)
      : undefined;
  const path = extractRequestPath(item, detail);
  const pathMatch = path.match(/\/authors\/([^/]+)\/refresh-request/i);

  return (
    getRecordString(entity, "id") ||
    getRecordString(entity, "authorId") ||
    getRecordString(summary, "authorId") ||
    getRecordString(metadata, "authorId") ||
    pathMatch?.[1]?.trim() ||
    ""
  );
}

function getRequesterLabel(
  item: AdminActivityLogListItem | null,
  detail: AdminActivityLogDetail | null,
  fallback: string,
) {
  const actor =
    detail?.actor && typeof detail.actor === "object"
      ? (detail.actor as Record<string, unknown>)
      : item?.actor && typeof item.actor === "object"
        ? (item.actor as Record<string, unknown>)
        : undefined;

  return (
    getRecordString(actor, "fullName") ||
    getRecordString(actor, "email") ||
    getRecordString(actor, "type") ||
    fallback
  );
}

function getAuthorLabel(
  item: AdminActivityLogListItem | null,
  detail: AdminActivityLogDetail | null,
  fallback: string,
) {
  const entity =
    detail?.entity && typeof detail.entity === "object"
      ? (detail.entity as Record<string, unknown>)
      : item?.entity && typeof item.entity === "object"
        ? (item.entity as Record<string, unknown>)
        : undefined;
  const summary =
    detail?.summary && typeof detail.summary === "object"
      ? (detail.summary as Record<string, unknown>)
      : undefined;

  return (
    getRecordString(entity, "name") ||
    getRecordString(summary, "authorName") ||
    item?.preview.title?.trim() ||
    fallback
  );
}

function formatDate(locale: string, value?: string) {
  if (!value) return "-";

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

export default function AdminRefreshRequestsPageClient() {
  const { locale, t } = useI18n();
  const { theme, toggle } = useTheme();
  const copy = useMemo(() => getAdminCopy(locale), [locale]);
  const { authState } = useAdminSession();
  const numberFormatter = useMemo(() => new Intl.NumberFormat(locale), [locale]);

  const [query, setQuery] = useState("");
  const [items, setItems] = useState<AdminActivityLogListItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [selectedDetail, setSelectedDetail] = useState<AdminActivityLogDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [note, setNote] = useState("");
  const [processing, setProcessing] = useState<"approve" | "dismiss" | null>(null);

  const adminBrandName = `${t("brand.name")} Admin`;

  const filteredItems = useMemo(() => {
    const normalizedQuery = normalizeSearchText(query);

    return items.filter((item) => {
      if (!isRefreshRequestItem(item)) {
        return false;
      }

      return matchesQuery(item, normalizedQuery);
    });
  }, [items, query]);

  const selectedItem = useMemo(
    () =>
      filteredItems.find((item) => getRequestSelectionKey(item) === selectedId) ?? null,
    [filteredItems, selectedId],
  );

  const pendingCount = useMemo(
    () => filteredItems.filter((item) => getRequestState(item.admin?.status) === "pending").length,
    [filteredItems],
  );
  const resolvedCount = useMemo(
    () => filteredItems.filter((item) => getRequestState(item.admin?.status) === "resolved").length,
    [filteredItems],
  );

  const selectedState = getRequestState(
    selectedDetail?.admin?.status ?? selectedItem?.admin?.status,
  );

  const summaryCards = useMemo(
    () => [
      {
        icon: Clock3,
        label: copy.refreshRequests.pendingTitle,
        value: numberFormatter.format(pendingCount),
        note: copy.refreshRequests.pendingNote,
        tone: "warning" as const,
      },
      {
        icon: CheckCircle2,
        label: copy.refreshRequests.approvedTitle,
        value: numberFormatter.format(resolvedCount),
        note: copy.refreshRequests.approvedNote,
        tone: "accent" as const,
      },
    ],
    [
      copy.refreshRequests,
      numberFormatter,
      pendingCount,
      resolvedCount,
    ],
  );

  const loadItems = async () => {
    setItemsLoading(true);
    setFeedback(null);

    try {
      const response = await api.admin.listActivityLogs({
        page: 1,
        pageSize: query.trim() ? 100 : 60,
        q: query.trim() ? undefined : "refresh-request",
      });

      setItems(response.items ?? []);
    } catch (error) {
      setFeedback({
        type: "error",
        text: getApiErrorMessage(
          error,
          copy.refreshRequests.messages.listFailed,
        ),
      });
      setItems([]);
    } finally {
      setItemsLoading(false);
    }
  };

  const loadDetail = async (id: string) => {
    if (!id) {
      setSelectedDetail(null);
      setNote("");
      return;
    }

    setDetailLoading(true);

    try {
      const detail = await api.admin.getActivityLog(id);
      setSelectedDetail(detail);
      setNote(detail.admin?.note ?? "");
    } catch (error) {
      setFeedback({
        type: "error",
        text: getApiErrorMessage(
          error,
          copy.refreshRequests.messages.detailFailed,
        ),
      });
      setSelectedDetail(null);
      setNote("");
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => {
    if (authState !== "ready") return;
    void loadItems();
  }, [authState]);

  useEffect(() => {
    if (!filteredItems.length) {
      setSelectedId("");
      setSelectedDetail(null);
      return;
    }

    if (
      !selectedId ||
      !filteredItems.some((item) => getRequestSelectionKey(item) === selectedId)
    ) {
      setSelectedId(getRequestSelectionKey(filteredItems[0] ?? null));
    }
  }, [filteredItems, selectedId]);

  useEffect(() => {
    if (authState !== "ready" || !selectedId) return;

    const nextSelectedItem =
      filteredItems.find((item) => getRequestSelectionKey(item) === selectedId) ?? null;
    const logId = getRequestLogId(nextSelectedItem);

    if (!logId) {
      setSelectedDetail(null);
      setNote("");
      setDetailLoading(false);
      return;
    }

    void loadDetail(logId);
  }, [authState, filteredItems, selectedId]);

  const handleApprove = async () => {
    if (!selectedItem) return;

    const authorId = extractAuthorId(selectedItem, selectedDetail);
    if (!authorId) {
      setFeedback({
        type: "error",
        text: copy.refreshRequests.messages.authorIdMissing,
      });
      return;
    }

    setProcessing("approve");
    setFeedback(null);

    try {
      await api.discovery.syncAuthorPublications(
        authorId,
        25,
        true,
        "all",
        { authToken: getStoredAuthToken() },
      );

      const selectedLogId = getRequestLogId(selectedItem);
      if (!selectedLogId) {
        throw new Error(copy.refreshRequests.messages.detailFailed);
      }

      await api.admin.updateActivityLog(selectedLogId, {
        admin: {
          status: "resolved",
          note: note.trim() || undefined,
        },
      });

      setFeedback({
        type: "success",
        text: copy.refreshRequests.messages.syncSuccess,
      });
      await loadItems();
      await loadDetail(selectedLogId);
    } catch (error) {
      setFeedback({
        type: "error",
        text: getApiErrorMessage(
          error,
          copy.refreshRequests.messages.approveFailed,
        ),
      });
    } finally {
      setProcessing(null);
    }
  };

  const handleDismiss = async () => {
    if (!selectedItem) return;

    setProcessing("dismiss");
    setFeedback(null);

    try {
      const selectedLogId = getRequestLogId(selectedItem);
      if (!selectedLogId) {
        throw new Error(copy.refreshRequests.messages.detailFailed);
      }

      await api.admin.updateActivityLog(selectedLogId, {
        admin: {
          status: "dismissed",
          note: note.trim() || undefined,
        },
      });

      setFeedback({
        type: "success",
        text: copy.refreshRequests.messages.dismissSuccess,
      });
      await loadItems();
      await loadDetail(selectedLogId);
    } catch (error) {
      setFeedback({
        type: "error",
        text: getApiErrorMessage(
          error,
          copy.refreshRequests.messages.dismissFailed,
        ),
      });
    } finally {
      setProcessing(null);
    }
  };

  if (authState === "loading") {
    return (
      <main className="authors-page admin-page">
        <div className="authors-shell">
          <AuthorPageTopbar
            backHref="/admin"
            backLabel={copy.refreshRequests.backLabel}
            brandName={adminBrandName}
            brandSubtitle={copy.refreshRequests.topbarSubtitle}
            theme={theme}
            themeToggleLabel={t("theme.toggle")}
            onToggleTheme={toggle}
          />
          <section className="admin-status-card">
            <ShieldCheck size={20} />
            <div>{copy.refreshRequests.loadingSession}</div>
          </section>
        </div>
      </main>
    );
  }

  if (authState === "unauthorized" || authState === "forbidden") {
    return (
      <main className="authors-page admin-page">
        <div className="authors-shell">
          <AuthorPageTopbar
            backHref="/admin"
            backLabel={copy.refreshRequests.backLabel}
            brandName={adminBrandName}
            brandSubtitle={copy.refreshRequests.topbarSubtitle}
            theme={theme}
            themeToggleLabel={t("theme.toggle")}
            onToggleTheme={toggle}
          />
          <section
            className={
              authState === "forbidden"
                ? "admin-status-card is-danger"
                : "admin-status-card is-warning"
            }
          >
            {authState === "forbidden" ? (
              <ShieldX size={20} />
            ) : (
              <ShieldAlert size={20} />
            )}
            <div>
              <strong>
                {authState === "forbidden"
                  ? copy.refreshRequests.forbiddenTitle
                  : copy.refreshRequests.unauthorizedTitle}
              </strong>
              <p>
                {authState === "forbidden"
                  ? copy.refreshRequests.forbiddenTitle
                  : copy.refreshRequests.unauthorizedBody}
              </p>
            </div>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="authors-page admin-page admin-refresh-page">
      <div className="authors-shell">
        <AuthorPageTopbar
          backHref="/admin"
          backLabel={copy.refreshRequests.backLabel}
          brandName={adminBrandName}
          brandSubtitle={copy.refreshRequests.topbarSubtitle}
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

        <section className="admin-search-card admin-search-card-refresh">
          <div className="admin-search-head admin-search-head-refresh">
            <div>
              <h2>{copy.refreshRequests.searchTitle}</h2>
            </div>
            <span className="admin-search-count">
              {numberFormatter.format(filteredItems.length)} {copy.refreshRequests.requestLabel.toLocaleLowerCase(locale)}
            </span>
          </div>

          <form
            className="admin-searchbar admin-searchbar-refresh"
            onSubmit={(event) => {
              event.preventDefault();
              void loadItems();
            }}
          >
            <div className="authors-search-input">
              <Search size={18} aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={copy.refreshRequests.searchPlaceholder}
              />
            </div>

            <div className="admin-searchbar-actions">
              <button
                type="submit"
                className="admin-primary-button admin-search-submit"
                disabled={itemsLoading}
              >
                <RefreshCcw
                  size={16}
                  className={itemsLoading ? "is-spinning" : undefined}
                />
                <span>{copy.refreshRequests.searchAction}</span>
              </button>
            </div>
          </form>
        </section>

        <section className="admin-overview-stats admin-overview-stats-refresh">
          {summaryCards.map((card) => (
            <SummaryCard
              key={card.label}
              icon={card.icon}
              label={card.label}
              value={card.value}
              note={card.note}
              tone={card.tone}
            />
          ))}
        </section>

        <section className="admin-request-grid admin-request-grid-refresh">
          <div className="admin-panel admin-panel-request-list">
            <div className="admin-panel-head">
              <div className="admin-panel-head-copy">
                <h2>{copy.refreshRequests.listTitle}</h2>
                <p>
                  {itemsLoading
                    ? copy.refreshRequests.searchAction
                    : `${numberFormatter.format(filteredItems.length)} ${copy.refreshRequests.requestLabel.toLocaleLowerCase(locale)}`}
                </p>
              </div>
            </div>

            {itemsLoading ? (
              <div className="admin-empty-card">{copy.refreshRequests.searchAction}</div>
            ) : filteredItems.length === 0 ? (
              <div className="admin-empty-card">{copy.refreshRequests.listEmpty}</div>
            ) : (
              <div className="admin-request-list">
                {filteredItems.map((item) => {
                  const requestState = getRequestState(item.admin?.status);
                  const selectionKey = getRequestSelectionKey(item);
                  const isActive = selectionKey === selectedId;
                  const requester = getRequesterLabel(
                    item,
                    null,
                    copy.refreshRequests.labels.unknownUser,
                  );
                  const authorLabel = getAuthorLabel(
                    item,
                    null,
                    copy.refreshRequests.labels.unknownAuthor,
                  );

                  return (
                    <button
                      key={selectionKey}
                      type="button"
                      className={isActive ? "admin-request-card is-active" : "admin-request-card"}
                      onClick={() => setSelectedId(selectionKey)}
                    >
                      <div className="admin-request-card-head">
                        <span className={`admin-request-status is-${requestState}`}>
                          {requestState === "resolved"
                            ? copy.refreshRequests.labels.resolved
                            : requestState === "dismissed"
                              ? copy.refreshRequests.labels.dismissed
                              : copy.refreshRequests.labels.pending}
                        </span>
                        <small>{formatDate(locale, item.createdAt)}</small>
                      </div>
                      <strong>{authorLabel}</strong>
                      <div className="admin-request-card-meta">
                        <span>{requester}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="admin-panel admin-request-detail admin-panel-request-detail">
            <div className="admin-panel-head admin-panel-head-request-detail">
              <div className="admin-panel-head-copy">
                <h2>{copy.refreshRequests.selectedTitle}</h2>
                <p>
                  {selectedItem
                    ? getAuthorLabel(
                        selectedItem,
                        selectedDetail,
                        copy.refreshRequests.labels.unknownAuthor,
                      )
                    : copy.refreshRequests.selectedEmpty}
                </p>
              </div>
              {selectedItem ? (
                <span className={`admin-request-status is-${selectedState}`}>
                  {selectedState === "resolved"
                    ? copy.refreshRequests.labels.resolved
                    : selectedState === "dismissed"
                      ? copy.refreshRequests.labels.dismissed
                      : copy.refreshRequests.labels.pending}
                </span>
              ) : null}
            </div>

            {detailLoading ? (
              <div className="admin-empty-card">{copy.refreshRequests.selectedLoading}</div>
            ) : !selectedItem ? (
              <div className="admin-empty-card">{copy.refreshRequests.selectedEmpty}</div>
            ) : (
              <div className="admin-request-detail-body">
                <div className="admin-request-detail-grid">
                  <div className="admin-request-detail-card">
                    <span>{copy.refreshRequests.author}</span>
                    <strong>
                      {getAuthorLabel(
                        selectedItem,
                        selectedDetail,
                        copy.refreshRequests.labels.unknownAuthor,
                      )}
                    </strong>
                  </div>
                  <div className="admin-request-detail-card">
                    <span>{copy.refreshRequests.requester}</span>
                    <strong>
                      {getRequesterLabel(
                        selectedItem,
                        selectedDetail,
                        copy.refreshRequests.labels.unknownUser,
                      )}
                    </strong>
                  </div>
                  <div className="admin-request-detail-card">
                    <span>{copy.logs.createdAt}</span>
                    <strong>{formatDate(locale, selectedItem.createdAt)}</strong>
                  </div>
                </div>

                <div className="admin-request-path-card">
                  <span>{copy.refreshRequests.requestPath}</span>
                  <strong>
                    {extractRequestPath(selectedItem, selectedDetail) ||
                      copy.refreshRequests.labels.noPath}
                  </strong>
                </div>

                <div className="admin-request-note-card">
                  <label className="admin-field">
                    <span>{copy.refreshRequests.note}</span>
                    <textarea
                      rows={5}
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder={copy.refreshRequests.notePlaceholder}
                    />
                  </label>
                </div>

                <div className="admin-detail-actions admin-request-actions">
                  <button
                    type="button"
                    className="admin-secondary-button admin-secondary-button-quiet"
                    onClick={() => {
                      const selectedLogId = getRequestLogId(selectedItem);
                      if (!selectedLogId) return;
                      void loadDetail(selectedLogId);
                    }}
                    disabled={
                      detailLoading ||
                      Boolean(processing) ||
                      !getRequestLogId(selectedItem)
                    }
                  >
                    <RefreshCcw size={16} />
                    <span>{copy.refreshRequests.refreshDetailAction}</span>
                  </button>
                  <button
                    type="button"
                    className="admin-secondary-button is-danger"
                    onClick={() => void handleDismiss()}
                    disabled={processing !== null || !getRequestLogId(selectedItem)}
                  >
                    <XCircle size={16} />
                    <span>
                      {processing === "dismiss"
                        ? copy.refreshRequests.dismissActionLoading
                        : copy.refreshRequests.dismissAction}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="admin-primary-button"
                    onClick={() => void handleApprove()}
                    disabled={
                      processing !== null ||
                      selectedState === "resolved" ||
                      !getRequestLogId(selectedItem)
                    }
                  >
                    <CheckCircle2 size={16} />
                    <span>
                      {processing === "approve"
                        ? copy.refreshRequests.approveActionLoading
                        : copy.refreshRequests.approveAction}
                    </span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
