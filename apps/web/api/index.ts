import { catalogApi } from "./platforms/catalog";
import { discoveryApi } from "./platforms/discovery";
import { scraperApi } from "./platforms/scraper";
import { serpapiApi } from "./platforms/serpapi";
import { systemApi } from "./platforms/system";
import { trdizinApi } from "./platforms/trdizin";
import { authApi } from "./platforms/auth";
import { adminApi } from "./platforms/admin";

export const api = {
  system: systemApi,
  serpapi: serpapiApi,
  trdizin: trdizinApi,
  scraper: scraperApi,
  catalog: catalogApi,
  discovery: discoveryApi,
  auth: authApi,
  admin: adminApi,
};

export * from "./client";
export * from "./platforms/scraper";
export * from "./platforms/serpapi";
export * from "./platforms/system";
export * from "./platforms/trdizin";
export * from "./platforms/catalog";
export * from "./platforms/discovery";
export * from "./platforms/auth";
export * from "./platforms/admin";
