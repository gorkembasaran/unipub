import { Types } from 'mongoose';
import { PublicationSyncService } from './publication-sync.service';

describe('PublicationSyncService Clarivate harvesting', () => {
  function createService(clarivateServiceOverrides: Record<string, unknown> = {}) {
    return new PublicationSyncService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      clarivateServiceOverrides as never,
      {} as never,
    );
  }

  const author = {
    _id: new Types.ObjectId(),
    fullName: 'Yilmaz Kemal Yuce',
    sourceProfiles: [
      {
        platform: 'clarivate_wos',
        externalAuthorId: 'AAB-1234-2020',
      },
    ],
  };

  it('normalizes Clarivate WoS publications into harvested publication records', async () => {
    const clarivateService = {
      searchAuthors: jest.fn().mockResolvedValue({
        authorQuery: 'Yilmaz Kemal Yuce',
        wosQuery: '(AU=(\"Yuce Yilmaz Kemal\") OR AU=(Yuce YK))',
        author: {
          displayName: 'Yilmaz Kemal Yuce',
          researcherId: 'AAB-1234-2020',
          wosStandard: 'Yuce, YK',
          documentCount: 1,
          sampleUids: ['WOS:0001'],
        },
        affiliations: [
          'Alanya Alaaddin Keykubat University, Computer Engineering Department, Antalya, Turkiye',
        ],
        publications: [
          {
            uid: 'WOS:0001',
            title:
              'Subjective Cognitive Load Evaluation of a Mobile Personal Health Record Application',
            sourceTitle: 'Stud Health Technol Inform',
            publishYear: 2025,
            publishMonth: 'JUL',
            volume: '19',
            issue: '4',
            pages: '101-110',
            authors: ['Yilmaz Kemal Yuce', 'Hasibe Yildiz'],
            doi: '10.1000/CLARIVATE.1',
            pmid: '40741296',
            citationCount: 4,
            recordUrl:
              'https://www.webofscience.com/wos/woscc/full-record/WOS:0001',
            authorNameInRecord: 'Yilmaz Kemal Yuce',
            matchedResearcherId: 'AAB-1234-2020',
            matchedWosStandard: 'Yuce, YK',
          },
        ],
        pagination: {
          pagesFetched: 1,
          hitsFetched: 1,
        },
        fetchedAt: '2026-05-14T10:00:00.000Z',
      }),
    };
    const service = createService(clarivateService);

    const result = await (service as any).harvestClarivatePublications(author, 10);

    expect(clarivateService.searchAuthors).toHaveBeenCalledWith(
      expect.objectContaining({
        preferredResearcherId: 'AAB-1234-2020',
        preferredWosStandard: 'AAB-1234-2020',
      }),
    );
    expect(result.status).toBe('ok');
    expect(result.totalRaw).toBe(1);
    expect(result.totalNormalized).toBe(1);
    expect(result.publications[0]).toMatchObject({
      title:
        'Subjective Cognitive Load Evaluation of a Mobile Personal Health Record Application',
      doi: '10.1000/clarivate.1',
      journal: 'Stud Health Technol Inform',
      publishedAt: '2025-07-01T00:00:00.000Z',
      publishedYear: 2025,
      volume: '19',
      issue: '4',
      pages: '101-110',
      pmid: '40741296',
      citationCount: 4,
      authors: ['Yilmaz Kemal Yuce', 'Hasibe Yildiz'],
    });
    expect(result.publications[0].sourceRecords[0]).toMatchObject({
      platform: 'clarivate_wos',
      sourceId: 'WOS:0001',
      sourceUrl:
        'https://www.webofscience.com/wos/woscc/full-record/WOS:0001',
    });
  });

  it('exposes Web Of Science as the display label for Clarivate source records', () => {
    const service = createService();

    const formatted = (service as any).formatPublicationOutput({
      title: 'A Clarivate-backed publication',
      authors: ['Yilmaz Kemal Yuce'],
      sourceRecords: [
        {
          platform: 'clarivate_wos',
          sourceId: 'WOS:0001',
          sourceUrl:
            'https://www.webofscience.com/wos/woscc/full-record/WOS:0001',
        },
      ],
    });

    expect(formatted.sourceRecords[0]).toMatchObject({
      platform: 'Web Of Science',
      platformKey: 'clarivate_wos',
      platformLabel: 'Web Of Science',
    });
  });

  it('exposes Web Of Science as the display label for provider results', () => {
    const service = createService();

    const formatted = (service as any).formatProviderResultOutput({
      platform: 'clarivate_wos',
      status: 'ok',
      totalRaw: 1,
      totalNormalized: 1,
      reason: undefined,
    });

    expect(formatted).toMatchObject({
      platform: 'Web Of Science',
      platformKey: 'clarivate_wos',
      platformLabel: 'Web Of Science',
      status: 'ok',
      totalRaw: 1,
      totalNormalized: 1,
    });
  });

  it('drops same-name Clarivate publications when affiliation context conflicts with the catalog author', async () => {
    const clarivateService = {
      searchAuthors: jest.fn().mockResolvedValue({
        authorQuery: 'Alperen Aksoy',
        wosQuery: '(AU=("Aksoy Alperen") OR AU=(Aksoy A))',
        author: {
          displayName: 'Aksoy, Alperen',
          wosStandard: 'Aksoy, A',
          affiliations: [
            'Alanya Alaaddin Keykubat University, Antalya, Turkiye',
          ],
          documentCount: 2,
          sampleUids: ['WOS:correct-1'],
        },
        affiliations: ['Alanya Alaaddin Keykubat University, Antalya, Turkiye'],
        publications: [
          {
            uid: 'WOS:wrong-1992',
            title: 'Very Old Wrong Paper',
            sourceTitle: 'Legacy Journal',
            publishYear: 1992,
            authors: ['Aksoy, Alperen'],
            doi: '10.1000/wrong-1992',
            matchedDisplayName: 'Aksoy, Alperen',
            authorNameInRecord: 'Aksoy, Alperen',
            matchedAffiliations: ['Another University, Ankara, Turkiye'],
          },
          {
            uid: 'WOS:correct-2024',
            title: 'Correct Recent Paper',
            sourceTitle: 'Modern Journal',
            publishYear: 2024,
            authors: ['Aksoy, Alperen'],
            doi: '10.1000/correct-2024',
            matchedDisplayName: 'Aksoy, Alperen',
            authorNameInRecord: 'Aksoy, Alperen',
            matchedAffiliations: [
              'Alanya Alaaddin Keykubat University, Antalya, Turkiye',
            ],
          },
        ],
        pagination: {
          pagesFetched: 1,
          hitsFetched: 2,
        },
        fetchedAt: '2026-05-14T10:00:00.000Z',
      }),
    };
    const service = createService(clarivateService);

    const result = await (service as any).harvestClarivatePublications(
      {
        _id: new Types.ObjectId(),
        fullName: 'Alperen Aksoy',
        university: 'Alanya Alaaddin Keykubat University',
        city: 'Antalya',
        country: 'Turkiye',
        affiliations: ['Alanya Alaaddin Keykubat University'],
        sourceProfiles: [
          {
            platform: 'clarivate_wos',
            externalAuthorId: 'Aksoy, A',
          },
        ],
      },
      10,
    );

    expect(result.status).toBe('ok');
    expect(result.totalRaw).toBe(2);
    expect(result.totalNormalized).toBe(1);
    expect(result.publications).toHaveLength(1);
    expect(result.publications[0]).toMatchObject({
      title: 'Correct Recent Paper',
      doi: '10.1000/correct-2024',
      publishedYear: 2024,
    });
  });
});
