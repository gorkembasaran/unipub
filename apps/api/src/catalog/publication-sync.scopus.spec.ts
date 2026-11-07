import { Types } from 'mongoose';
import { PublicationSyncService } from './publication-sync.service';

describe('PublicationSyncService Scopus harvesting', () => {
  function createService(scraperServiceOverrides: Record<string, unknown> = {}) {
    return new PublicationSyncService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      scraperServiceOverrides as never,
    );
  }

  const author = {
    _id: new Types.ObjectId(),
    fullName: 'Yılmaz Kemal Yüce',
    sourceProfiles: [
      {
        platform: 'scraper_scopus',
        externalAuthorId: '18635626400',
        profileUrl: 'https://www.scopus.com/authid/detail.uri?authorId=18635626400',
      },
    ],
  };

  it('normalizes parsed Scopus publications into harvested publication records', () => {
    const service = createService();

    const normalized = (service as any).normalizeScopusPublication(
      {
        sourceId: '2-s2.0-85123456789',
        articleUrl:
          'https://www.scopus.com/record/display.uri?eid=2-s2.0-85123456789',
        title:
          'Subjective Cognitive Load Evaluation of a Mobile Personal Health Record Application',
        journal: 'Stud Health Technol Inform',
        authors: ['Yuce, Y.', 'Yildiz, H.'],
        authorsText: 'Yuce, Y.; Yildiz, H.',
        publishedYear: 2023,
        citationCount: 7,
        doi: '10.3233/SHTI230793',
        documentType: 'Conference Paper',
      },
      {
        authorId: '18635626400',
        authorName: 'Yuce, Yilmaz',
        previewMode: false,
        renderMode: 'rendered',
      },
    );

    expect(normalized).toEqual({
      title:
        'Subjective Cognitive Load Evaluation of a Mobile Personal Health Record Application',
      normalizedTitle:
        'subjective cognitive load evaluation of a mobile personal health record application',
      doi: '10.3233/shti230793',
      fingerprint:
        'subjective cognitive load evaluation of a mobile personal health record application|2023|stud health technol inform',
      titleYearKey:
        'subjective cognitive load evaluation of a mobile personal health record application|2023',
      journal: 'Stud Health Technol Inform',
      publishedAt: undefined,
      publishedYear: 2023,
      authors: ['Yuce, Y', 'Yildiz, H'],
      authorsText: 'Yuce, Y.; Yildiz, H.',
      abstract: undefined,
      snippet: undefined,
      keywords: [],
      publisher: undefined,
      volume: undefined,
      issue: undefined,
      pages: undefined,
      language: undefined,
      pmid: undefined,
      citationCount: 7,
      sourceRecords: [
        {
          platform: 'scraper_scopus',
          sourceId: '2-s2.0-85123456789',
          sourceUrl:
            'https://www.scopus.com/record/display.uri?eid=2-s2.0-85123456789',
          metadata: {
            documentType: 'Conference Paper',
            authorDetailSummary: {
              authorId: '18635626400',
              authorName: 'Yuce, Yilmaz',
              previewMode: false,
              renderMode: 'rendered',
            },
            rawPublication: {
              sourceId: '2-s2.0-85123456789',
              articleUrl:
                'https://www.scopus.com/record/display.uri?eid=2-s2.0-85123456789',
              title:
                'Subjective Cognitive Load Evaluation of a Mobile Personal Health Record Application',
              journal: 'Stud Health Technol Inform',
              authors: ['Yuce, Y.', 'Yildiz, H.'],
              authorsText: 'Yuce, Y.; Yildiz, H.',
              publishedYear: 2023,
              citationCount: 7,
              doi: '10.3233/SHTI230793',
              documentType: 'Conference Paper',
            },
          },
        },
      ],
    });
  });

  it('marks Scopus preview-only document panels as skipped', async () => {
    const scraperService = {
      scrapeScopusAuthorDetailById: jest.fn().mockResolvedValue({
        detailParsed: {
          authorId: '18635626400',
          authorName: 'Yuce, Yilmaz',
          previewMode: true,
          renderMode: 'rendered',
          metrics: {
            documents: 25,
          },
          publicationSummary: {
            totalDocuments: 25,
            renderedDocuments: 2,
            visibleDocuments: 0,
            limitedAccess: true,
            previewMode: true,
            hasVisibleList: false,
            documentPanelMessage: 'Results list, nothing to display.',
          },
          publications: [],
        },
      }),
    };
    const service = createService(scraperService);

    const result = await (service as any).harvestScopusPublications(author);

    expect(result).toEqual({
      platform: 'scraper_scopus',
      status: 'skipped',
      totalRaw: 0,
      totalNormalized: 0,
      reason:
        'Scopus Preview modunda document listesi sinirli erisim nedeniyle acilmadi. Toplam document sayisi 25 olarak gorunuyor.',
      publications: [],
    });
  });

  it('harvests Scopus publications when rendered detail contains document records', async () => {
    const scraperService = {
      scrapeScopusAuthorDetailById: jest.fn().mockResolvedValue({
        detailParsed: {
          authorId: '18635626400',
          authorName: 'Yuce, Yilmaz',
          previewMode: false,
          renderMode: 'rendered',
          metrics: {
            documents: 1,
          },
          publicationSummary: {
            totalDocuments: 1,
            renderedDocuments: 1,
            visibleDocuments: 1,
            limitedAccess: false,
            previewMode: false,
            hasVisibleList: true,
          },
          publications: [
            {
              sourceId: '2-s2.0-85123456789',
              articleUrl:
                'https://www.scopus.com/record/display.uri?eid=2-s2.0-85123456789',
              title:
                'Subjective Cognitive Load Evaluation of a Mobile Personal Health Record Application',
              journal: 'Stud Health Technol Inform',
              authors: ['Yuce, Y.', 'Yildiz, H.'],
              authorsText: 'Yuce, Y.; Yildiz, H.',
              publishedYear: 2023,
              citationCount: 7,
              doi: '10.3233/SHTI230793',
            },
          ],
        },
      }),
    };
    const service = createService(scraperService);

    const result = await (service as any).harvestScopusPublications(author);

    expect(result.status).toBe('ok');
    expect(result.totalRaw).toBe(1);
    expect(result.totalNormalized).toBe(1);
    expect(result.publications).toHaveLength(1);
    expect(result.publications[0]).toMatchObject({
      title:
        'Subjective Cognitive Load Evaluation of a Mobile Personal Health Record Application',
      doi: '10.3233/shti230793',
      journal: 'Stud Health Technol Inform',
      publishedYear: 2023,
      authors: ['Yuce, Y', 'Yildiz, H'],
      citationCount: 7,
    });
  });
});
