"use client";

import { useEffect, useRef, useState } from "react";
import {
  doesCatalogAuthorMatchIdentity,
  findBestDiscoveryAuthorMatch,
} from "@/api/platforms/authorIdentity";
import type {
  CatalogPublicationDateFilter,
  CatalogPublicationSyncResponse,
} from "@/api/platforms/catalog";
import { api } from "@/api";
import { getApiErrorMessage } from "../utils/apiErrors";
import type { Author, Publication, TranslateFn } from "./authorPage.types";
import { compact } from "./authorPageUtils";

type UseAuthorProfileDataOptions = {
  affiliation: string;
  authorId: string;
  authorName: string;
  city: string;
  country: string;
  dateFilter: CatalogPublicationDateFilter;
  department: string;
  t: TranslateFn;
};

type UseAuthorProfileDataResult = {
  author: Author | null;
  error: string | null;
  loading: boolean;
  profileSource: "catalog" | "live_search";
  publications: Publication[];
  syncResult: CatalogPublicationSyncResponse | null;
  syncing: boolean;
};

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

type CachedCatalogPublicationBundle = {
  publications: Publication[];
  syncResult: CatalogPublicationSyncResponse;
};

const AUTHOR_PROFILE_TTL_MS = 30_000;

const catalogAuthorCache = new Map<string, CacheEntry<Author>>();
const catalogAuthorPending = new Map<string, Promise<Author>>();

const catalogPublicationCache = new Map<
  string,
  CacheEntry<CachedCatalogPublicationBundle>
>();
const catalogPublicationPending = new Map<
  string,
  Promise<CachedCatalogPublicationBundle>
>();

const livePublicationCache = new Map<string, CacheEntry<Publication[]>>();
const livePublicationPending = new Map<string, Promise<Publication[]>>();

function isFresh<T>(entry?: CacheEntry<T>) {
  return Boolean(entry && entry.expiresAt > Date.now());
}

async function loadCachedValue<T>(
  key: string,
  cache: Map<string, CacheEntry<T>>,
  pending: Map<string, Promise<T>>,
  loader: () => Promise<T>,
) {
  const cached = cache.get(key);
  if (isFresh(cached)) {
    return cached!.value;
  }

  const existingPending = pending.get(key);
  if (existingPending) {
    return existingPending;
  }

  const request = loader()
    .then((value) => {
      cache.set(key, {
        value,
        expiresAt: Date.now() + AUTHOR_PROFILE_TTL_MS,
      });
      return value;
    })
    .finally(() => {
      pending.delete(key);
    });

  pending.set(key, request);
  return request;
}

function getCatalogAuthorCached(authorId: string) {
  return loadCachedValue(
    authorId,
    catalogAuthorCache,
    catalogAuthorPending,
    () => api.discovery.getAuthor(authorId),
  );
}

function getCatalogPublicationsCached(authorId: string) {
  return loadCachedValue(
    authorId,
    catalogPublicationCache,
    catalogPublicationPending,
    async () => {
      const syncResult = await api.discovery.syncAuthorPublications(
        authorId,
        25,
        false,
        "all",
      );

      return {
        publications: syncResult.publications ?? [],
        syncResult,
      };
    },
  );
}

function setCatalogPublicationsCached(
  authorId: string,
  value: CachedCatalogPublicationBundle,
) {
  catalogPublicationCache.set(authorId, {
    value,
    expiresAt: Date.now() + AUTHOR_PROFILE_TTL_MS,
  });
}

function getLivePublicationsCached(cacheKey: string, authorName: string) {
  return loadCachedValue(
    cacheKey,
    livePublicationCache,
    livePublicationPending,
    () => api.discovery.listPublications(undefined, authorName, "all"),
  );
}

export function useAuthorProfileData({
  affiliation,
  authorId,
  authorName,
  city,
  country,
  dateFilter: _dateFilter,
  department,
  t,
}: UseAuthorProfileDataOptions): UseAuthorProfileDataResult {
  const lastProfileIdentityRef = useRef("");

  const [author, setAuthor] = useState<Author | null>(null);
  const [publications, setPublications] = useState<Publication[]>([]);
  const [loading, setLoading] = useState(false);
  const [profileSource, setProfileSource] = useState<"catalog" | "live_search">("catalog");
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncResult, setSyncResult] =
    useState<CatalogPublicationSyncResponse | null>(null);

  const profileIdentityKey = [
    authorId,
    authorName,
    affiliation,
    department,
    city,
    country,
  ].join("|");

  useEffect(() => {
    let cancelled = false;
    const identityHints = {
      affiliation,
      department,
      city,
      country,
    };

    const resolveCatalogAuthorIdByName = async (name: string) => {
      const matches = await api.discovery.searchAuthors(name, 10, {
        city: city?.trim() || undefined,
        country: country?.trim() || undefined,
      });

      return (
        findBestDiscoveryAuthorMatch(matches.items ?? [], name, identityHints)?.dbAuthorId?.trim() ??
        ""
      );
    };

    const loadCatalogProfile = async (
      resolvedAuthorId: string,
      requestedName: string,
      options: {
        trustResolvedId?: boolean;
      } = {},
    ) => {
      const applyCatalogProfile = (
        authorData: Author,
        publicationBundle: CachedCatalogPublicationBundle,
      ) => {
        setProfileSource("catalog");
        setAuthor(authorData);
        setSyncResult(publicationBundle.syncResult);
        setPublications(publicationBundle.publications);
        lastProfileIdentityRef.current = profileIdentityKey;
      };

      if (options.trustResolvedId) {
        const [authorData, publicationBundle] = await Promise.all([
          getCatalogAuthorCached(resolvedAuthorId),
          getCatalogPublicationsCached(resolvedAuthorId),
        ]);
        if (cancelled) return false;

        applyCatalogProfile(authorData, publicationBundle);
        return true;
      }

      const authorData = await getCatalogAuthorCached(resolvedAuthorId);
      if (cancelled) return false;

      if (
        requestedName &&
        !doesCatalogAuthorMatchIdentity(authorData, requestedName, identityHints)
      ) {
        return false;
      }

      const publicationBundle = await getCatalogPublicationsCached(resolvedAuthorId);
      if (cancelled) return false;

      applyCatalogProfile(authorData, publicationBundle);
      return true;
    };

    const load = async () => {
      if (!authorId && !authorName) return;
      const isSameProfile = lastProfileIdentityRef.current === profileIdentityKey;

      setLoading(true);
      setError(null);
      setSyncing(false);

      if (!isSameProfile) {
        setAuthor(null);
        setSyncResult(null);
        setPublications([]);
      }

      try {
        const requestedName = authorName.trim();

        if (authorId) {
          const loadedWithRequestedId = await loadCatalogProfile(
            authorId,
            requestedName,
            { trustResolvedId: true },
          );
          if (loadedWithRequestedId) {
            return;
          }
        }

        if (requestedName) {
          const resolvedAuthorId = await resolveCatalogAuthorIdByName(requestedName);

          if (resolvedAuthorId) {
            const loadedResolvedProfile = await loadCatalogProfile(
              resolvedAuthorId,
              requestedName,
            );
            if (loadedResolvedProfile) {
              return;
            }
          }
        }

        if (authorId && !requestedName) {
          return;
        }

        const authorData: Author = {
          _id: authorName,
          fullName: authorName,
          affiliations: compact([
            affiliation,
            department,
            compact([city, country]).join(", "),
          ]),
        };
        const publicationData = await getLivePublicationsCached(
          profileIdentityKey,
          authorName,
        );
        if (cancelled) return;

        lastProfileIdentityRef.current = profileIdentityKey;
        setProfileSource("live_search");
        setAuthor(authorData);
        setSyncResult(null);
        setPublications(publicationData ?? []);
      } catch (err) {
        if (cancelled) return;
        setError(getApiErrorMessage(err, t("author.publications.load_failed")));
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [
    affiliation,
    authorId,
    authorName,
    city,
    country,
    department,
    profileIdentityKey,
    t,
  ]);

  return {
    author,
    error,
    loading,
    profileSource,
    publications,
    syncResult,
    syncing,
  };
}
