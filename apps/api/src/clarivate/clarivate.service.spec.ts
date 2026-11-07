import { ClarivateService } from './clarivate.service';

describe('ClarivateService searchAuthors pagination', () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.CLARIVATE_WOS_STARTER_API_KEY;
  const originalResearcherApiKey =
    process.env.CLARIVATE_WOS_RESEARCHER_API_KEY;

  beforeEach(() => {
    process.env.CLARIVATE_WOS_STARTER_API_KEY = 'test-key';
    delete process.env.CLARIVATE_WOS_RESEARCHER_API_KEY;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.CLARIVATE_WOS_STARTER_API_KEY = originalApiKey;
    process.env.CLARIVATE_WOS_RESEARCHER_API_KEY =
      originalResearcherApiKey;
    jest.restoreAllMocks();
  });

  it('paginates across document pages and prefers the requested researcher id', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          metadata: {
            total: 3,
            page: 1,
            limit: 2,
          },
          hits: [
            {
              uid: 'WOS:wrong-1',
              title: 'Wrong Author Paper 1',
              names: {
                authors: [
                  {
                    displayName: 'Yuce, Yilmaz Kemal',
                    researcherId: 'RID-OTHER',
                    wosStandard: 'Yuce, YK',
                  },
                ],
              },
              source: {
                sourceTitle: 'Journal A',
                publishYear: 2023,
                publishMonth: 'JAN',
              },
              identifiers: {
                doi: '10.1000/wrong-1',
              },
              links: {
                record: 'https://www.webofscience.com/wos/woscc/full-record/WOS:wrong-1',
              },
            },
            {
              uid: 'WOS:wrong-2',
              title: 'Wrong Author Paper 2',
              names: {
                authors: [
                  {
                    displayName: 'Yuce, Yilmaz Kemal',
                    researcherId: 'RID-OTHER',
                    wosStandard: 'Yuce, YK',
                  },
                ],
              },
              source: {
                sourceTitle: 'Journal A',
                publishYear: 2024,
                publishMonth: 'FEB',
              },
              identifiers: {
                doi: '10.1000/wrong-2',
              },
              links: {
                record: 'https://www.webofscience.com/wos/woscc/full-record/WOS:wrong-2',
              },
            },
          ],
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          metadata: {
            total: 3,
            page: 2,
            limit: 2,
          },
          hits: [
            {
              uid: 'WOS:target-1',
              title: 'Target Author Paper',
              names: {
                authors: [
                  {
                    displayName: 'Yuce, Yilmaz Kemal',
                    researcherId: 'RID-TARGET',
                    wosStandard: 'Yuce, YK',
                    preferredAffiliation:
                      'Alanya Alaaddin Keykubat University, Antalya, Turkiye',
                  },
                ],
              },
              source: {
                sourceTitle: 'Journal B',
                publishYear: 2025,
                publishMonth: 'MAR',
                volume: '19',
                issue: '1',
                pages: '10-20',
              },
              identifiers: {
                doi: '10.1000/target-1',
                pmid: '123456',
              },
              citations: [
                {
                  db: 'WOS',
                  count: 7,
                },
              ],
              links: {
                record: 'https://www.webofscience.com/wos/woscc/full-record/WOS:target-1',
              },
            },
          ],
        }),
      } as Response) as typeof fetch;

    const service = new ClarivateService();
    const result = await service.searchAuthors({
      q: 'Yilmaz Kemal Yuce',
      limit: 2,
      maxPages: 2,
      preferredResearcherId: 'RID-TARGET',
    });

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(String((global.fetch as jest.Mock).mock.calls[1]?.[0] ?? '')).toContain(
      'page=2',
    );
    expect(result.author).toMatchObject({
      displayName: 'Yuce, Yilmaz Kemal',
      researcherId: 'RID-TARGET',
    });
    expect(result.pagination).toEqual(
      expect.objectContaining({
        pagesFetched: 2,
        hitsFetched: 3,
      }),
    );
    expect(result.publications).toHaveLength(1);
    expect(result.publications[0]).toMatchObject({
      uid: 'WOS:target-1',
      doi: '10.1000/target-1',
      citationCount: 7,
      matchedResearcherId: 'RID-TARGET',
    });
  });

  it('returns only the institution-matching author when same-name WoS candidates are ambiguous', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        metadata: {
          total: 2,
          page: 1,
          limit: 10,
        },
        hits: [
          {
            uid: 'WOS:old-1',
            title: 'Old Wrong Paper',
            names: {
              authors: [
                {
                  displayName: 'Aksoy, Alperen',
                  wosStandard: 'Aksoy, A',
                  preferredAffiliation:
                    'Another University, Ankara, Turkiye',
                },
              ],
            },
            source: {
              sourceTitle: 'Legacy Journal',
              publishYear: 1992,
            },
            identifiers: {
              doi: '10.1000/old-wrong',
            },
          },
          {
            uid: 'WOS:new-1',
            title: 'Current Correct Paper',
            names: {
              authors: [
                {
                  displayName: 'Aksoy, Alperen',
                  wosStandard: 'Aksoy, A',
                  preferredAffiliation:
                    'Alanya Alaaddin Keykubat University, Antalya, Turkiye',
                },
              ],
            },
            source: {
              sourceTitle: 'Modern Journal',
              publishYear: 2024,
            },
            identifiers: {
              doi: '10.1000/new-correct',
            },
          },
        ],
      }),
    } as Response) as typeof fetch;

    const service = new ClarivateService();
    const result = await service.searchAuthors({
      q: 'Alperen Aksoy',
      limit: 10,
      preferredDisplayName: 'Alperen Aksoy',
      preferredUniversity: 'Alanya Alaaddin Keykubat University',
      preferredCity: 'Antalya',
      preferredCountry: 'Turkiye',
      preferredAffiliations: ['Alanya Alaaddin Keykubat University'],
    });

    expect(result.author).toMatchObject({
      displayName: 'Aksoy, Alperen',
      wosStandard: 'Aksoy, A',
      affiliations: ['Alanya Alaaddin Keykubat University, Antalya, Turkiye'],
    });
    expect(result.publications).toHaveLength(1);
    expect(result.publications[0]).toMatchObject({
      uid: 'WOS:new-1',
      doi: '10.1000/new-correct',
      publishYear: 2024,
      matchedAffiliations: ['Alanya Alaaddin Keykubat University, Antalya, Turkiye'],
    });
  });

  it('enriches abbreviated WoS names with researcher profile details when researcher api is configured', async () => {
    process.env.CLARIVATE_WOS_RESEARCHER_API_KEY = 'researcher-key';

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          metadata: {
            total: 1,
            page: 1,
            limit: 10,
          },
          hits: [
            {
              uid: 'WOS:arslan-1',
              title: 'Starter API Paper',
              names: {
                authors: [
                  {
                    displayName: 'ARSLAN, E',
                    researcherId: 'RID-ENIS',
                    wosStandard: 'Arslan, E',
                    preferredAffiliation:
                      'Alanya Alaaddin Keykubat University, Antalya, Turkiye',
                  },
                ],
              },
              source: {
                sourceTitle: 'Journal A',
                publishYear: 2025,
              },
              identifiers: {
                doi: '10.1000/arslan-1',
              },
            },
          ],
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          researcherId: 'RID-ENIS',
          fullName: 'Enis Arslan',
          primaryAffiliation: {
            organization: 'Alanya Alaaddin Keykubat University',
            city: 'Antalya',
            country: 'Turkiye',
          },
          affiliations: [
            {
              organization: 'Alanya Alaaddin Keykubat University',
              city: 'Antalya',
              country: 'Turkiye',
            },
          ],
        }),
      } as Response) as typeof fetch;

    const service = new ClarivateService();
    const result = await service.searchAuthors({
      q: 'Enis Arslan',
      limit: 10,
    });

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(String((global.fetch as jest.Mock).mock.calls[1]?.[0] ?? '')).toContain(
      '/researchers/RID-ENIS',
    );
    expect(result.author).toMatchObject({
      displayName: 'Enis Arslan',
      researcherId: 'RID-ENIS',
    });
    expect(result.affiliations).toEqual(
      expect.arrayContaining([
        'Alanya Alaaddin Keykubat University',
        'Alanya Alaaddin Keykubat University, Antalya, Turkiye',
      ]),
    );
  });
});
