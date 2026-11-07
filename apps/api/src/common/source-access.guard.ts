import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';

// Route prefix -> source key used in ENABLED_SOURCES. More specific prefixes first.
const SOURCE_ROUTES: Array<[prefix: string, source: string]> = [
  ['/scraper/pubmed', 'pubmed'],
  ['/scraper', 'scopus'],
  ['/serpapi', 'scholar'],
  ['/clarivate', 'wos'],
  ['/trdizin', 'trdizin'],
  ['/openalex', 'openalex'],
];

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const isTruthy = (value?: string) =>
  ['1', 'true', 'yes', 'on'].includes((value ?? '').trim().toLowerCase());

/**
 * DEMO_MODE=true makes the whole API read-only (public demo).
 * ENABLED_SOURCES=openalex,pubmed,... limits which source endpoints are reachable;
 * when unset every source stays enabled.
 */
@Injectable()
export class SourceAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    const method = request.method.toUpperCase();
    const path = (request.path ?? request.url ?? '').toLowerCase();

    if (isTruthy(process.env.DEMO_MODE) && !SAFE_METHODS.has(method)) {
      throw new ForbiddenException('Demo modu salt okunurdur.');
    }

    const enabledSources = this.readEnabledSources();
    if (!enabledSources) {
      return true;
    }

    const match = SOURCE_ROUTES.find(
      ([prefix]) => path === prefix || path.startsWith(`${prefix}/`),
    );
    if (match && !enabledSources.has(match[1])) {
      throw new ForbiddenException(`"${match[1]}" kaynagi bu sunucuda kapali.`);
    }

    return true;
  }

  private readEnabledSources() {
    const raw = process.env.ENABLED_SOURCES?.trim();
    if (!raw) {
      return null;
    }
    return new Set(
      raw
        .split(',')
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    );
  }
}
