"use client";

import { api } from "@/api";
import type {
  AdminAuthorSearchResponse,
  AdminCatalogAuthor,
  AdminCatalogPublication,
} from "@/api";

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

type AdminAuthorBundle = {
  author: AdminCatalogAuthor;
  publications: AdminCatalogPublication[];
};

type CacheOptions = {
  force?: boolean;
};

const SEARCH_TTL_MS = 30_000;
const BUNDLE_TTL_MS = 30_000;

const searchCache = new Map<string, CacheEntry<AdminAuthorSearchResponse>>();
const searchPending = new Map<string, Promise<AdminAuthorSearchResponse>>();

const bundleCache = new Map<string, CacheEntry<AdminAuthorBundle>>();
const bundlePending = new Map<string, Promise<AdminAuthorBundle>>();

function isFresh<T>(entry?: CacheEntry<T>) {
  return Boolean(entry && entry.expiresAt > Date.now());
}

function buildSearchKey(query: string, limit: number) {
  return `${limit}:${query.trim().toLocaleLowerCase("tr-TR")}`;
}

export async function searchAdminAuthorsCached(
  query: string,
  limit = 20,
  options: CacheOptions = {},
) {
  const key = buildSearchKey(query, limit);
  if (options.force) {
    searchCache.delete(key);
  } else {
    const cached = searchCache.get(key);
    if (isFresh(cached)) {
      return cached!.value;
    }
    const pending = searchPending.get(key);
    if (pending) {
      return pending;
    }
  }

  const request = api.admin
    .searchAuthors(query, limit)
    .then((response) => {
      searchCache.set(key, {
        value: response,
        expiresAt: Date.now() + SEARCH_TTL_MS,
      });
      return response;
    })
    .finally(() => {
      searchPending.delete(key);
    });

  searchPending.set(key, request);
  return request;
}

export async function getAdminAuthorBundleCached(
  authorId: string,
  options: CacheOptions = {},
) {
  if (options.force) {
    bundleCache.delete(authorId);
  } else {
    const cached = bundleCache.get(authorId);
    if (isFresh(cached)) {
      return cached!.value;
    }
    const pending = bundlePending.get(authorId);
    if (pending) {
      return pending;
    }
  }

  const request = Promise.all([
    api.admin.getAuthor(authorId),
    api.admin.getAuthorPublications(authorId),
  ])
    .then(([author, publications]) => {
      const bundle = { author, publications };
      bundleCache.set(authorId, {
        value: bundle,
        expiresAt: Date.now() + BUNDLE_TTL_MS,
      });
      return bundle;
    })
    .finally(() => {
      bundlePending.delete(authorId);
    });

  bundlePending.set(authorId, request);
  return request;
}

export function primeAdminAuthorBundle(bundle: AdminAuthorBundle) {
  bundleCache.set(bundle.author._id, {
    value: bundle,
    expiresAt: Date.now() + BUNDLE_TTL_MS,
  });
}

export function updateCachedAdminAuthor(author: AdminCatalogAuthor) {
  const existing = bundleCache.get(author._id);
  if (!existing) return;
  bundleCache.set(author._id, {
    value: {
      author,
      publications: existing.value.publications,
    },
    expiresAt: Date.now() + BUNDLE_TTL_MS,
  });
}

export function invalidateAdminAuthorBundle(authorId?: string) {
  if (!authorId) {
    bundleCache.clear();
    bundlePending.clear();
    return;
  }
  bundleCache.delete(authorId);
  bundlePending.delete(authorId);
}

export function invalidateAdminAuthorSearches() {
  searchCache.clear();
  searchPending.clear();
}
