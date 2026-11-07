import { Types } from 'mongoose';
import { PublicationSyncService } from './publication-sync.service';

describe('PublicationSyncService Scholar DOI enrichment', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function createService(
    serpapiServiceOverrides: Record<string, unknown> = {},
  ) {
    return new PublicationSyncService(
      {} as never,
      {} as never,
      serpapiServiceOverrides as never,
      {} as never,
      {} as never,
      {} as never,
    );
  }

  const author = {
    _id: new Types.ObjectId(),
    fullName: 'Yılmaz Kemal Yüce',
    sourceProfiles: [
      {
        platform: 'serpapi_scholar',
        externalAuthorId: 'main456',
        profileUrl: 'https://scholar.google.com/citations?user=main456',
      },
    ],
  };

  it('prefers DOI found on Scholar citation detail pages', async () => {
    global.fetch = jest.fn() as typeof fetch;

    const serpapiService = {
      getAuthorPublications: jest.fn().mockResolvedValue({
        publications: [
          {
            title:
              'Classification of finger movements through optimal EEG channel and feature selection.',
            publication: 'Frontiers in human neuroscience 19, 1633910, 2025',
            year: 2025,
            citationId: 'main456:pub-1',
            authors: 'M. Degirmenci, Y. Yuce',
            citedBy: 3,
          },
        ],
      }),
      getAuthorPublicationDetail: jest.fn().mockResolvedValue({
        citation: {
          link: 'https://doi.org/10.3389/fnhum.2025.1633910',
          authors: 'M. Degirmenci, Y. Yuce',
          publicationDate: '2025/07/16',
          journal: 'Frontiers in Human Neuroscience',
          volume: '19',
          pages: '1633910',
          publisher: 'Frontiers Media SA',
          description: 'A concise abstract from Scholar detail.',
        },
      }),
    };
    const service = createService(serpapiService);

    const result = await (service as any).harvestSerpapiPublications(author, 10);

    expect(result.status).toBe('ok');
    expect(result.totalRaw).toBe(1);
    expect(result.publications[0]).toMatchObject({
      doi: '10.3389/fnhum.2025.1633910',
      journal: 'Frontiers in Human Neuroscience',
      publishedAt: '2025-07-16T00:00:00.000Z',
      publishedYear: 2025,
      volume: '19',
      pages: '1633910',
      publisher: 'Frontiers Media SA',
      abstract: 'A concise abstract from Scholar detail.',
    });
    expect(result.publications[0].sourceRecords[0]?.sourceUrl).toContain(
      'citation_for_view=main456%3Apub-1',
    );
    expect(result.publications[0].sourceRecords[0]?.sourceUrl).not.toContain(
      'main456%3Amain456%3A',
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('falls back to Crossref when Scholar detail does not expose a DOI', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        message: {
          items: [
            {
              DOI: '10.3389/fnhum.2025.1633910',
              title: [
                'Classification of finger movements through optimal EEG channel and feature selection.',
              ],
              author: [{ family: 'Yuce' }],
              issued: {
                'date-parts': [[2025, 7, 16]],
              },
              'container-title': ['Frontiers in Human Neuroscience'],
              URL: 'https://doi.org/10.3389/fnhum.2025.1633910',
              score: 28,
            },
          ],
        },
      }),
    } as Response) as typeof fetch;

    const serpapiService = {
      getAuthorPublications: jest.fn().mockResolvedValue({
        publications: [
          {
            title:
              'Classification of finger movements through optimal EEG channel and feature selection.',
            publication: 'Frontiers in human neuroscience 19, 1633910, 2025',
            year: 2025,
            citationId: 'main456:pub-1',
            authors: 'M. Degirmenci, Y. Yuce',
            citedBy: 3,
          },
        ],
      }),
      getAuthorPublicationDetail: jest.fn().mockResolvedValue({
        citation: {
          link: 'https://www.frontiersin.org/journals/human-neuroscience/articles/finger-movements-eeg/full',
          authors: 'M. Degirmenci, Y. Yuce',
          publicationDate: '2025/07/16',
          journal: 'Frontiers in Human Neuroscience',
          volume: '19',
          pages: '1633910',
        },
      }),
    };
    const service = createService(serpapiService);

    const result = await (service as any).harvestSerpapiPublications(author, 10);

    expect(result.status).toBe('ok');
    expect(result.publications[0]?.doi).toBe('10.3389/fnhum.2025.1633910');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(String((global.fetch as jest.Mock).mock.calls[0]?.[0] ?? '')).toContain(
      'api.crossref.org/works',
    );
  });
});
