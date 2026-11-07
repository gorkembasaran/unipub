import { inspect } from 'node:util';
import { CatalogService } from './catalog.service';

describe('CatalogService DB author search', () => {
  function createService() {
    return new CatalogService({} as never, {} as never, {} as never);
  }

  it('derives surname and initials from Turkish-style full names', () => {
    const service = createService();

    const signature = (service as any).buildAuthorSearchSignature(
      'Yılmaz Kemal Yüce',
    );

    expect(signature).toMatchObject({
      normalizedQuery: 'yilmaz kemal yuce',
      surname: 'yuce',
      givenTokens: ['yilmaz', 'kemal'],
      compactInitials: 'yk',
    });
  });

  it('adds a surname gate for multi-token author queries', () => {
    const service = createService();

    const filter = (service as any).buildAuthorSearchFilter('Enis Arslan');
    const rendered = inspect(filter, { depth: null });

    expect(filter).toHaveProperty('$and');
    expect(rendered).toContain('arslan');
    expect(rendered).toContain('sourceProfiles.externalAuthorId');
    expect(rendered).toContain('searchKeywords');
  });

  it('pushes city, country and institution filters into the DB query', () => {
    const service = createService();

    const filter = (service as any).buildAuthorSearchFilter(
      'Yılmaz Kemal Yüce',
      {
        country: 'turkiye',
        city: 'antalya',
        institution: 'inst-alku',
      },
    );
    const rendered = inspect(filter, { depth: null });

    expect(rendered).toContain('institutionCanonicalKey');
    expect(rendered).toContain('inst-alku');
    expect(rendered).toContain('alku');
    expect(rendered).toContain('antalya');
    expect(rendered).toContain('turkiye');
  });
});
