import { PublicationSyncService } from './publication-sync.service';

describe('PublicationSyncService PubMed normalization', () => {
  function createService() {
    return new PublicationSyncService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  }

  it('parses PubMed journal citations with a full date and DOI', () => {
    const service = createService();

    const parsed = (service as any).parsePubmedJournalCitation(
      'Stud Health Technol Inform. 2023 Oct 20;309:262-266. doi: 10.3233/SHTI230793.',
    );

    expect(parsed).toEqual({
      doi: '10.3233/shti230793',
      journal: 'Stud Health Technol Inform',
      publishedAt: '2023-10-20T00:00:00.000Z',
      publishedYear: 2023,
      volume: '309',
      issue: undefined,
      pages: '262-266',
    });
  });

  it('parses PubMed journal citations with month-only dates and issue metadata', () => {
    const service = createService();

    const parsed = (service as any).parsePubmedJournalCitation(
      'Healthc Inform Res. 2023 Oct;29(4):367-376. doi: 10.4258/hir.2023.29.4.367. Epub 2023 Oct 31.',
    );

    expect(parsed).toEqual({
      doi: '10.4258/hir.2023.29.4.367',
      journal: 'Healthc Inform Res',
      publishedAt: '2023-10-01T00:00:00.000Z',
      publishedYear: 2023,
      volume: '29',
      issue: '4',
      pages: '367-376',
    });
  });

  it('normalizes PubMed publications into harvested publication records', () => {
    const service = createService();

    const normalized = (service as any).normalizePubmedPublication({
      pmid: '37869854',
      title:
        'Subjective Cognitive Load Evaluation of a Mobile Personal Health Record Application.',
      articleUrl: 'https://pubmed.ncbi.nlm.nih.gov/37869854/',
      journalCitation:
        'Stud Health Technol Inform. 2023 Oct 20;309:262-266. doi: 10.3233/SHTI230793.',
      authors: 'Zayim N, Yildiz H, Yüce YK.',
      snippet: 'A short snippet',
      detail: {
        citationDate: '2023 Oct 20',
        fullAuthors: ['Neşe Zayim', 'Hasibe Yıldız', 'Yilmaz Kemal Yüce'],
        abstract:
          'Objectives: Mobile health applications that are designed without considering usability criteria can lead to cognitive overload.',
      },
      score: 13,
      matchedBy: ['yuce YK[Author]'],
    });

    expect(normalized).toEqual({
      title:
        'Subjective Cognitive Load Evaluation of a Mobile Personal Health Record Application.',
      normalizedTitle:
        'subjective cognitive load evaluation of a mobile personal health record application',
      doi: '10.3233/shti230793',
      fingerprint:
        'subjective cognitive load evaluation of a mobile personal health record application|2023|stud health technol inform',
      titleYearKey:
        'subjective cognitive load evaluation of a mobile personal health record application|2023',
      journal: 'Stud Health Technol Inform',
      publishedAt: '2023-10-20T00:00:00.000Z',
      publishedYear: 2023,
      authors: ['Neşe Zayim', 'Hasibe Yıldız', 'Yilmaz Kemal Yüce'],
      authorsText: 'Neşe Zayim, Hasibe Yıldız, Yilmaz Kemal Yüce',
      abstract:
        'Objectives: Mobile health applications that are designed without considering usability criteria can lead to cognitive overload.',
      snippet: 'A short snippet',
      keywords: [],
      publisher: undefined,
      volume: '309',
      issue: undefined,
      pages: '262-266',
      language: undefined,
      pmid: '37869854',
      citationCount: undefined,
      sourceRecords: [
        {
          platform: 'scraper_pubmed',
          sourceId: '37869854',
          sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/37869854/',
          metadata: {
            journalCitation:
              'Stud Health Technol Inform. 2023 Oct 20;309:262-266. doi: 10.3233/SHTI230793.',
            score: 13,
            matchedBy: ['yuce YK[Author]'],
            rawPublication: {
              pmid: '37869854',
              title:
                'Subjective Cognitive Load Evaluation of a Mobile Personal Health Record Application.',
              articleUrl: 'https://pubmed.ncbi.nlm.nih.gov/37869854/',
              journalCitation:
                'Stud Health Technol Inform. 2023 Oct 20;309:262-266. doi: 10.3233/SHTI230793.',
              authors: 'Zayim N, Yildiz H, Yüce YK.',
              snippet: 'A short snippet',
              detail: {
                citationDate: '2023 Oct 20',
                fullAuthors: [
                  'Neşe Zayim',
                  'Hasibe Yıldız',
                  'Yilmaz Kemal Yüce',
                ],
                abstract:
                  'Objectives: Mobile health applications that are designed without considering usability criteria can lead to cognitive overload.',
              },
              score: 13,
              matchedBy: ['yuce YK[Author]'],
            },
          },
        },
      ],
    });
  });

  it('drops malformed TR Dizin publishedAt values when only the year is trustworthy', () => {
    const service = createService();

    const normalized = (service as any).normalizeTrdizinPublication({
      id: 'trdizin-1',
      orderTitle: 'A TR Dizin article',
      publishDate: '0001',
      publicationYear: 1991,
      authors: [
        {
          inPublicationName: 'T. Arslan',
        },
      ],
    });

    expect(normalized).toEqual(
      expect.objectContaining({
        title: 'A TR Dizin article',
        publishedAt: undefined,
        publishedYear: 1991,
      }),
    );
  });

  it('restores missing spaces in TR Dizin title word boundaries', () => {
    const service = createService();

    const normalized = (service as any).normalizeTrdizinPublication({
      id: 'trdizin-joined-title',
      orderTitle:
        'MobilSağlık Uygulamalarında Bilişsel Yük ve Kullanılabilirlik',
      publicationYear: 2024,
      authors: [
        {
          inPublicationName: 'Y. K. Yüce',
        },
      ],
    });

    expect(normalized).toEqual(
      expect.objectContaining({
        title:
          'Mobil Sağlık Uygulamalarında Bilişsel Yük ve Kullanılabilirlik',
      }),
    );
  });

  it('restores TR Dizin titles whose first token is glued to a short English word', () => {
    const service = createService();

    const normalized = (service as any).normalizeTrdizinPublication({
      id: 'trdizin-glued-english-title',
      orderTitle:
        'Evaluationof mother wavelets on steady-state visually-evoked potentials',
      publicationYear: 2021,
      authors: [
        {
          inPublicationName: 'Y. K. Yüce',
        },
      ],
    });

    expect(normalized).toEqual(
      expect.objectContaining({
        title:
          'Evaluation of mother wavelets on steady-state visually-evoked potentials',
      }),
    );
  });

  it('cleans trailing punctuation from abbreviated PubMed author strings', () => {
    const service = createService();

    expect((service as any).splitAuthorText('Zayim N, Yildiz H, Yüce YK.')).toEqual([
      'Zayim N',
      'Yildiz H',
      'Yüce YK',
    ]);
  });

  it('prefers the richest author display when duplicate author names arrive from multiple platforms', () => {
    const service = createService();

    expect(
      (service as any).mergeAuthorArrays(
        ['M Degirmenci', 'YK Yuce', 'M Perc', 'Y Isler'],
        [
          'Degirmenci M',
          'Yuce YK',
          'Perc M',
          'Isler Y',
          'Yilmaz Kemal Yuce',
        ],
      ),
    ).toEqual(['M Degirmenci', 'Yilmaz Kemal Yuce', 'M Perc', 'Y Isler']);
  });

  it('keeps a single source link per platform and prefers the active author profile link', () => {
    const service = createService();

    const formatted = (service as any).formatPublicationOutput(
      {
        authors: ['YK Yuce', 'Yuce YK'],
        authorsText: 'YK Yuce, Yuce YK',
        sourceRecords: [
          {
            platform: 'serpapi_scholar',
            sourceId: 'coauthor123:pub-1',
            sourceUrl:
              'https://scholar.google.com/citations?user=coauthor123&citation_for_view=coauthor123:pub-1',
            metadata: {
              rawPublication: {
                citationId: 'coauthor123:pub-1',
                serpapiLink:
                  'https://scholar.google.com/citations?user=coauthor123&citation_for_view=coauthor123:pub-1',
              },
            },
          },
          {
            platform: 'serpapi_scholar',
            sourceId: 'main456:pub-1',
            sourceUrl:
              'https://scholar.google.com/citations?user=main456&citation_for_view=main456:pub-1',
            metadata: {
              rawPublication: {
                citationId: 'main456:pub-1',
                serpapiLink:
                  'https://scholar.google.com/citations?user=main456&citation_for_view=main456:pub-1',
              },
            },
          },
          {
            platform: 'scraper_pubmed',
            sourceId: '40741296',
            sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/40741296/',
          },
        ],
      },
      [{ platform: 'serpapi_scholar', externalAuthorId: 'main456' }],
    );

    expect(formatted.authors).toEqual(['YK Yuce']);
    expect(formatted.sourceRecords).toHaveLength(2);
    expect(formatted.sourceRecords[0]).toMatchObject({
      platform: 'serpapi_scholar',
      sourceId: 'main456:pub-1',
    });
  });

  it('treats compatible author initials as a match but rejects unrelated initials', () => {
    const service = createService();

    expect(
      (service as any).matchesCatalogAuthor(
        {
          _id: 'author-1',
          fullName: 'Adil Enis Arslan',
          aliases: [],
        },
        ['Arslan, Enis', 'Başka Yazar'],
      ),
    ).toBe(true);
    expect(
      (service as any).matchesCatalogAuthor(
        {
          _id: 'author-1',
          fullName: 'Adil Enis Arslan',
          aliases: [],
        },
        ['T. Arslan'],
      ),
    ).toBe(false);
  });

  it('drops PubMed items that do not have a title', () => {
    const service = createService();

    expect(
      (service as any).normalizePubmedPublication({
        pmid: 'missing-title',
        authors: 'Yüce YK.',
      }),
    ).toBeNull();
  });
});
