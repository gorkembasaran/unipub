"use client";

import { useEffect, useState } from "react";
import { api } from "@/api";
import type {
  DiscoveryAuthorFiltersResponse,
  DiscoveryAuthorSearchFilters,
} from "@/api/platforms/discovery";

const emptyFilters: DiscoveryAuthorFiltersResponse = {
  selected: {
    country: null,
    city: null,
    school: null,
  },
  countries: [],
  cities: [],
  schools: [],
  fetchedAt: new Date(0).toISOString(),
};

export function useDiscoveryFilters(filters: DiscoveryAuthorSearchFilters) {
  const [data, setData] = useState<DiscoveryAuthorFiltersResponse>(emptyFilters);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;

    const load = async () => {
      setLoading(true);
      setReady(false);
      setError(null);

      try {
        const response = await api.discovery.getAuthorFilters(filters);
        if (active) {
          setData(response);
        }
      } catch (err) {
        if (active) {
          const message = err instanceof Error ? err.message : "Filtreler yuklenemedi.";
          setError(message);
          setData((current) => (current.countries.length || current.cities.length || current.schools.length ? current : emptyFilters));
        }
      } finally {
        if (active) {
          setLoading(false);
          setReady(true);
        }
      }
    };

    void load();

    return () => {
      active = false;
    };
  }, [filters.city, filters.country, filters.institution, filters.school, filters.university]);

  return {
    filterData: data,
    filterLoading: loading,
    filterError: error,
    filterReady: ready,
  };
}
