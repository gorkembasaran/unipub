import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { SourceAccessGuard } from './source-access.guard';

const contextFor = (method: string, path: string) =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ method, path }),
    }),
  }) as unknown as ExecutionContext;

describe('SourceAccessGuard', () => {
  const originalEnv = { ...process.env };
  const guard = new SourceAccessGuard();

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('allows everything when neither DEMO_MODE nor ENABLED_SOURCES is set', () => {
    delete process.env.DEMO_MODE;
    delete process.env.ENABLED_SOURCES;

    expect(guard.canActivate(contextFor('POST', '/auth/register'))).toBe(true);
    expect(guard.canActivate(contextFor('GET', '/serpapi/scholar/authors'))).toBe(true);
  });

  it('blocks writes but allows reads in demo mode', () => {
    process.env.DEMO_MODE = 'true';

    expect(guard.canActivate(contextFor('GET', '/catalog/publications'))).toBe(true);
    expect(() =>
      guard.canActivate(contextFor('POST', '/discovery/authors/1/publications/sync')),
    ).toThrow(ForbiddenException);
    expect(() => guard.canActivate(contextFor('POST', '/auth/register'))).toThrow(
      ForbiddenException,
    );
  });

  it('only exposes source endpoints listed in ENABLED_SOURCES', () => {
    process.env.ENABLED_SOURCES = 'openalex, pubmed';

    expect(guard.canActivate(contextFor('GET', '/openalex/authors'))).toBe(true);
    expect(guard.canActivate(contextFor('GET', '/scraper/pubmed/authors'))).toBe(true);
    expect(guard.canActivate(contextFor('GET', '/catalog/stats'))).toBe(true);
    expect(() =>
      guard.canActivate(contextFor('GET', '/scraper/scopus/authors')),
    ).toThrow(ForbiddenException);
    expect(() =>
      guard.canActivate(contextFor('GET', '/serpapi/scholar/authors')),
    ).toThrow(ForbiddenException);
    expect(() =>
      guard.canActivate(contextFor('GET', '/clarivate/wos-starter/documents')),
    ).toThrow(ForbiddenException);
  });
});
