import { DiscoveryService } from './discovery.service';

describe('DiscoveryService PubMed mapping', () => {
  function createService() {
    return new DiscoveryService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  }

  function createDiscoverAuthorsService(input?: {
    dbResults?: Array<Record<string, unknown>>;
    serpapiAuthors?: Array<Record<string, unknown>>;
    trdizinAuthors?: Array<Record<string, unknown>>;
    scopusAuthors?: Array<Record<string, unknown>>;
    pubmedResult?: Record<string, unknown>;
    clarivateResult?: Record<string, unknown>;
  }) {
    let savedCounter = 0;
    const serpapiService = {
      searchAuthorsNormalized: jest
        .fn()
        .mockResolvedValue({ authors: input?.serpapiAuthors ?? [] }),
    };
    const trdizinService = {
      searchAuthorsNormalized: jest
        .fn()
        .mockResolvedValue({ authors: input?.trdizinAuthors ?? [] }),
    };
    const scraperService = {
      searchScopusAuthors: jest
        .fn()
        .mockResolvedValue({ authors: input?.scopusAuthors ?? [] }),
      searchPubmedAuthor: jest
        .fn()
        .mockResolvedValue(input?.pubmedResult ?? { matchedArticles: [] }),
    };
    const clarivateService = {
      searchAuthors: jest
        .fn()
        .mockResolvedValue(input?.clarivateResult ?? { author: null }),
    };
    const catalogService = {
      searchAuthorsDbOnly: jest
        .fn()
        .mockResolvedValue(input?.dbResults ?? []),
      upsertDiscoveredAuthor: jest
        .fn()
        .mockImplementation(async (authorInput: Record<string, unknown>) => ({
          authorId: `saved-${++savedCounter}`,
          status: 'existing',
          author: {
            _id: `saved-${savedCounter}`,
            fullName: authorInput.displayName,
            normalizedName: authorInput.normalizedName,
            affiliations: authorInput.affiliationRaw ?? [],
            parsedAffiliations: authorInput.parsedAffiliations ?? [],
            searchKeywords: authorInput.searchKeywords ?? [],
            institutionAliases: authorInput.institutionAliases ?? [],
            sourceProfiles: authorInput.sourceProfiles ?? [],
            university: authorInput.university,
            city: authorInput.city,
            country: authorInput.country,
            emailDomain: authorInput.emailDomain,
          },
        })),
    };
    const publicationSyncService = {};

    return {
      service: new DiscoveryService(
        serpapiService as never,
        trdizinService as never,
        scraperService as never,
        clarivateService as never,
        catalogService as never,
        publicationSyncService as never,
      ),
      serpapiService,
      trdizinService,
      scraperService,
      clarivateService,
      catalogService,
    };
  }

  function createCandidate(input: {
    displayName: string;
    normalizedName: string;
    platform: string;
    externalAuthorId: string;
    keywords?: string[];
    affiliations?: Array<Record<string, unknown>>;
    affiliationRaw?: string[];
    university?: string;
    institutionKey?: string;
    institutionAliases?: string[];
    city?: string;
    country?: string;
    score?: number;
  }) {
    return {
      displayName: input.displayName,
      normalizedName: input.normalizedName,
      affiliations: input.affiliations ?? [],
      affiliationRaw: input.affiliationRaw ?? [],
      searchIndex: {
        keywords: input.keywords ?? input.normalizedName.split(' ').filter(Boolean),
        university: input.university,
        institutionKey: input.institutionKey,
        institutionAliases: input.institutionAliases ?? [],
        city: input.city,
        country: input.country,
      },
      sourceProfiles: [
        {
          platform: input.platform,
          externalAuthorId: input.externalAuthorId,
          score: input.score ?? 0,
        },
      ],
      score: input.score ?? 0,
    };
  }

  it('extracts abbreviated PubMed author candidates and ranks them by frequency', () => {
    const service = createService();

    const mapped = (service as any).mapPubmedScraperAuthors(
      'Yılmaz Kemal Yüce',
      {
        nameParts: {
          firstName: 'Yılmaz Kemal',
          lastName: 'Yüce',
        },
        matchedArticles: [
          {
            authors: 'Zayim N, Yuce YK , Perc M',
            score: 13,
          },
          {
            authors: 'Degirmenci M, Yüce YK., Isler Y',
            score: 14,
          },
          {
            authors: 'Another Person, Yuce YA',
            score: 12,
          },
        ],
      },
    );

    expect(mapped).toEqual([
      {
        displayName: 'Yuce YK',
        normalizedName: 'yuce yk',
        affiliations: [],
        affiliationRaw: [],
        searchIndex: {
          keywords: ['yuce', 'yk'],
          institutionKey: undefined,
          institutionAliases: [],
        },
        sourceProfiles: [
          {
            platform: 'scraper_pubmed',
            externalAuthorId: 'yuce yk',
            profileUrl:
              'https://pubmed.ncbi.nlm.nih.gov/?term=yuce%20yk%5BAuthor%5D',
            score: 20,
          },
        ],
        score: 20,
      },
      {
        displayName: 'Yuce YA',
        normalizedName: 'yuce ya',
        affiliations: [],
        affiliationRaw: [],
        searchIndex: {
          keywords: ['yuce', 'ya'],
          institutionKey: undefined,
          institutionAliases: [],
        },
        sourceProfiles: [
          {
            platform: 'scraper_pubmed',
            externalAuthorId: 'yuce ya',
            profileUrl:
              'https://pubmed.ncbi.nlm.nih.gov/?term=yuce%20yk%5BAuthor%5D',
            score: 15,
          },
        ],
        score: 15,
      },
    ]);
  });

  it('maps Clarivate author matches into unified discovery candidates', async () => {
    const { service, clarivateService, catalogService } =
      createDiscoverAuthorsService({
        clarivateResult: {
          author: {
            displayName: 'Yılmaz Kemal Yüce',
            researcherId: 'AAB-1234-2020',
            wosStandard: 'Yuce, YK',
            documentCount: 6,
            sampleUids: ['WOS:0001'],
          },
          affiliations: [
            'Alanya Alaaddin Keykubat University, Computer Engineering Department, Antalya, Türkiye',
          ],
          publications: [],
        },
      });

    const result = await service.discoverAuthors('Yılmaz Kemal Yüce', 5);

    expect(clarivateService.searchAuthors).toHaveBeenCalled();
    expect(result.providers.clarivate).toBe(1);
    expect(result.items[0].sourceProfiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          platform: 'Web Of Science',
          platformKey: 'clarivate_wos',
        }),
      ]),
    );
    expect(catalogService.upsertDiscoveredAuthor).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceProfiles: expect.arrayContaining([
          expect.objectContaining({
            platform: 'clarivate_wos',
            externalAuthorId: 'AAB-1234-2020',
          }),
        ]),
      }),
    );
  });

  it('maps top Clarivate candidates into discovery when no single author can be selected yet', async () => {
    const { service, clarivateService, catalogService } =
      createDiscoverAuthorsService({
        clarivateResult: {
          author: null,
          candidates: [
            {
              displayName: 'ARSLAN, E',
              researcherId: 'EMR-0310-2022',
              wosStandard: 'ARSLAN, E',
              documentCount: 4,
              affiliations: [],
            },
            {
              displayName: 'ARSLAN, A',
              researcherId: 'AAA-0000-2022',
              wosStandard: 'ARSLAN, A',
              documentCount: 2,
              affiliations: [],
            },
          ],
          affiliations: [],
          publications: [],
        },
      });

    const result = await service.discoverAuthors('Enis Arslan', 5);

    expect(clarivateService.searchAuthors).toHaveBeenCalledWith(
      expect.objectContaining({
        q: 'Enis Arslan',
        includeCandidates: true,
      }),
    );
    expect(result.providers.clarivate).toBe(2);
    expect(catalogService.upsertDiscoveredAuthor).toHaveBeenCalledWith(
      expect.objectContaining({
        normalizedName: 'e arslan',
        sourceProfiles: expect.arrayContaining([
          expect.objectContaining({
            platform: 'clarivate_wos',
            externalAuthorId: 'EMR-0310-2022',
          }),
        ]),
      }),
    );
  });

  it('falls back to the original query when PubMed articles exist but author tokens are not parseable', () => {
    const service = createService();

    const mapped = (service as any).mapPubmedScraperAuthors(
      'Yılmaz Kemal Yüce',
      {
        nameParts: {
          firstName: 'Yılmaz Kemal',
          lastName: 'Yüce',
        },
        matchedArticles: [
          {
            authors: null,
            score: 9,
          },
        ],
      },
    );

    expect(mapped).toEqual([
      {
        displayName: 'Yılmaz Kemal Yüce',
        normalizedName: 'yilmaz kemal yuce',
        affiliations: [],
        affiliationRaw: [],
        searchIndex: {
          keywords: ['yilmaz', 'kemal', 'yuce'],
          institutionKey: undefined,
          institutionAliases: [],
        },
        sourceProfiles: [
          {
            platform: 'scraper_pubmed',
            externalAuthorId: 'yilmaz kemal yuce',
            profileUrl:
              'https://pubmed.ncbi.nlm.nih.gov/?term=Y%C4%B1lmaz%20Kemal%20Y%C3%BCce',
            score: 1,
          },
        ],
        score: 1,
      },
    ]);
  });

  it('prefers full PubMed detail author names and affiliations when detail data exists', () => {
    const service = createService();

    const mapped = (service as any).mapPubmedScraperAuthors(
      'Yılmaz Kemal Yüce',
      {
        nameParts: {
          firstName: 'Yılmaz Kemal',
          lastName: 'Yüce',
        },
        matchedArticles: [
          {
            authors: 'Zayim N, Yuce YK',
            score: 14,
            detail: {
              authorDetails: [
                {
                  fullName: 'Neşe Zayim',
                  affiliations: [
                    'Department of Biostatistics and Medical Informatics, Faculty of Medicine, Akdeniz University, Antalya, Türkiye.',
                  ],
                },
                {
                  fullName: 'Yilmaz Kemal Yüce',
                  affiliations: [
                    'Department of Computer Engineering, Alanya Alaaddin Keykubat University, Antalya, Türkiye.',
                  ],
                },
              ],
            },
          },
        ],
      },
    );

    expect(mapped).toHaveLength(1);
    expect(mapped[0]).toMatchObject({
      displayName: 'Yilmaz Kemal Yüce',
      normalizedName: 'yilmaz kemal yuce',
      affiliationRaw: [
        'Department of Computer Engineering, Alanya Alaaddin Keykubat University, Antalya, Türkiye.',
      ],
      searchIndex: expect.objectContaining({
        university: 'Alanya Alaaddin Keykubat University',
        city: 'Antalya',
        country: 'Türkiye',
      }),
      sourceProfiles: [
        {
          platform: 'scraper_pubmed',
          externalAuthorId: 'yilmaz kemal yuce',
          profileUrl:
            'https://pubmed.ncbi.nlm.nih.gov/?term=yuce%20yk%5BAuthor%5D',
          score: 17,
        },
      ],
      score: 17,
    });
    expect(mapped[0].affiliations).toEqual([
      expect.objectContaining({
        raw: 'Department of Computer Engineering, Alanya Alaaddin Keykubat University, Antalya, Türkiye.',
        city: 'Antalya',
        country: 'Türkiye',
      }),
    ]);
  });

  it('returns an empty list when PubMed yields no matched articles', () => {
    const service = createService();

    const mapped = (service as any).mapPubmedScraperAuthors(
      'Yılmaz Kemal Yüce',
      {
        nameParts: {
          firstName: 'Yılmaz Kemal',
          lastName: 'Yüce',
        },
        matchedArticles: [],
      },
    );

    expect(mapped).toEqual([]);
  });

  it('merges PubMed abbreviations into richer full-name identities and keeps the canonical full name', () => {
    const service = createService();

    const merged = (service as any).mergeAndDeduplicate([
      createCandidate({
        displayName: 'Yuce YK',
        normalizedName: 'yuce yk',
        platform: 'scraper_pubmed',
        externalAuthorId: 'yuce yk',
        score: 20,
      }),
      createCandidate({
        displayName: 'Yılmaz Kemal Yüce',
        normalizedName: 'yilmaz kemal yuce',
        platform: 'trdizin',
        externalAuthorId: '905079',
        keywords: [
          'yilmaz',
          'kemal',
          'yuce',
          'firat',
          'universitesi',
          'elazig',
          'turkiye',
        ],
        university: 'Firat Universitesi',
        city: 'Elazig',
        country: 'Turkiye',
        score: 98,
      }),
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      displayName: 'Yılmaz Kemal Yüce',
      normalizedName: 'yilmaz kemal yuce',
    });
    expect(merged[0].sourceProfiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          platform: 'scraper_pubmed',
          externalAuthorId: 'yuce yk',
        }),
        expect.objectContaining({
          platform: 'trdizin',
          externalAuthorId: '905079',
        }),
      ]),
    );
  });

  it('merges single-letter PubMed abbreviations into fuller PubMed identities', () => {
    const service = createService();

    const merged = (service as any).mergeAndDeduplicate([
      createCandidate({
        displayName: 'Arslan E',
        normalizedName: 'arslan e',
        platform: 'scraper_pubmed',
        externalAuthorId: 'arslan e',
        score: 12,
      }),
      createCandidate({
        displayName: 'Arslan, Enis',
        normalizedName: 'enis arslan',
        platform: 'scraper_pubmed',
        externalAuthorId: 'enis arslan',
        score: 28,
      }),
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      displayName: 'Arslan, Enis',
      normalizedName: 'enis arslan',
    });
    expect(merged[0].sourceProfiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          platform: 'scraper_pubmed',
          externalAuthorId: 'arslan e',
        }),
        expect.objectContaining({
          platform: 'scraper_pubmed',
          externalAuthorId: 'enis arslan',
        }),
      ]),
    );
  });

  it('merges PubMed full-name variants into richer multi-token identities when trailing tokens align', () => {
    const service = createService();

    const merged = (service as any).mergeAndDeduplicate([
      createCandidate({
        displayName: 'Arslan, Enis',
        normalizedName: 'enis arslan',
        platform: 'scraper_pubmed',
        externalAuthorId: 'enis arslan',
        score: 24,
      }),
      createCandidate({
        displayName: 'Adil Enis Arslan',
        normalizedName: 'adil enis arslan',
        platform: 'serpapi_scholar',
        externalAuthorId: 'scholar-arslan-1',
        score: 95,
      }),
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      displayName: 'Adil Enis Arslan',
      normalizedName: 'adil enis arslan',
    });
    expect(merged[0].sourceProfiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          platform: 'scraper_pubmed',
          externalAuthorId: 'enis arslan',
        }),
        expect.objectContaining({
          platform: 'serpapi_scholar',
          externalAuthorId: 'scholar-arslan-1',
        }),
      ]),
    );
  });

  it('does not merge broad two-token names into longer identities without stronger evidence', () => {
    const service = createService();

    const merged = (service as any).mergeAndDeduplicate([
      createCandidate({
        displayName: 'Yılmaz Yüce',
        normalizedName: 'yilmaz yuce',
        platform: 'scraper_scopus',
        externalAuthorId: 'scopus-1',
        score: 40,
      }),
      createCandidate({
        displayName: 'Yılmaz Kemal Yüce',
        normalizedName: 'yilmaz kemal yuce',
        platform: 'trdizin',
        externalAuthorId: '905079',
        score: 98,
      }),
    ]);

    expect(merged).toHaveLength(2);
  });

  it('merges source-noise display names into the canonical identity', () => {
    const service = createService();

    const merged = (service as any).mergeAndDeduplicate([
      createCandidate({
        displayName: 'EMRAH IRMAK - Google Akademik',
        normalizedName: 'emrah irmak',
        platform: 'serpapi_scholar',
        externalAuthorId: 'scholar-emrah-1',
        keywords: ['emrah', 'irmak', 'alanya', 'alaaddin', 'keykubat'],
        university: 'Alanya Alaaddin Keykubat University',
        city: 'Antalya',
        country: 'Türkiye',
        score: 58,
      }),
      createCandidate({
        displayName: 'Emrah Irmak',
        normalizedName: 'emrah irmak',
        platform: 'trdizin',
        externalAuthorId: '905080',
        keywords: ['emrah', 'irmak', 'gaziantep', 'universitesi'],
        university: 'Gaziantep Üniversitesi',
        city: 'Gaziantep',
        country: 'Türkiye',
        score: 86,
      }),
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      displayName: 'Emrah Irmak',
      normalizedName: 'emrah irmak',
    });
    expect(merged[0].sourceProfiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          platform: 'serpapi_scholar',
          externalAuthorId: 'scholar-emrah-1',
        }),
        expect.objectContaining({
          platform: 'trdizin',
          externalAuthorId: '905080',
        }),
      ]),
    );
  });

  it('does not merge candidates that carry different ids from the same stable platform', () => {
    const service = createService();

    const merged = (service as any).mergeAndDeduplicate([
      createCandidate({
        displayName: 'Kübra Uyar',
        normalizedName: 'kubra uyar',
        platform: 'trdizin',
        externalAuthorId: '1027335',
        keywords: ['kubra', 'uyar', 'alanya', 'alaaddin', 'keykubat'],
        university: 'Alanya Alaaddin Keykubat Üniversitesi',
        city: 'Antalya',
        country: 'Türkiye',
        score: 95,
      }),
      {
        ...createCandidate({
          displayName: 'Fatma Kübra Uyar',
          normalizedName: 'fatma kubra uyar',
          platform: 'trdizin',
          externalAuthorId: '1004553',
          keywords: ['fatma', 'kubra', 'uyar', 'amasya'],
          university: 'Amasya Üniversitesi',
          city: 'Amasya',
          country: 'Türkiye',
          score: 88,
        }),
        sourceProfiles: [
          {
            platform: 'trdizin',
            externalAuthorId: '1004553',
            score: 88,
          },
          {
            platform: 'serpapi_scholar',
            externalAuthorId: 'aNPE8O8AAAAJ',
            score: 10,
          },
        ],
      },
    ]);

    expect(merged).toHaveLength(2);
    expect(merged.map((item: any) => item.displayName)).toEqual(
      expect.arrayContaining(['Kübra Uyar', 'Fatma Kübra Uyar']),
    );
  });

  it('query-guidedly merges Clarivate abbreviated names into the single strong full-name candidate', async () => {
    const { service } = createDiscoverAuthorsService({
      serpapiAuthors: [
        {
          author_id: 'scholar-enis-1',
          name: 'Enis Arslan',
          normalizedName: 'enis arslan',
          affiliation: 'Alanya Alaaddin Keykubat University, Antalya, Türkiye',
          cited_by: 12,
          score: 12,
        },
      ],
      clarivateResult: {
        author: null,
        candidates: [
          {
            displayName: 'ARSLAN, E',
            researcherId: 'EMR-0310-2022',
            wosStandard: 'ARSLAN, E',
            documentCount: 4,
            affiliations: [],
          },
        ],
        affiliations: [],
        publications: [],
      },
    });

    const result = await service.discoverAuthors('Enis Arslan', 10);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      displayName: 'Enis Arslan',
      normalizedName: 'enis arslan',
    });
    expect(result.items[0].sourceProfilesRaw).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          platform: 'clarivate_wos',
          externalAuthorId: 'EMR-0310-2022',
        }),
        expect.objectContaining({
          platform: 'serpapi_scholar',
          externalAuthorId: 'scholar-enis-1',
        }),
      ]),
    );
  });

  it('query-guidedly merges Clarivate compound-surname abbreviations into the matching full-name candidate', async () => {
    const { service } = createDiscoverAuthorsService({
      trdizinAuthors: [
        {
          displayName: 'Kübra Karacan Uyar',
          authorId: '905080',
          normalizedName: 'kubra karacan uyar',
          score: 84,
          affiliations: [
            'Afyon Kocatepe Üniversitesi, Afyonkarahisar, Türkiye',
          ],
        },
      ],
      clarivateResult: {
        author: null,
        candidates: [
          {
            displayName: 'KARACAN UYAR, K',
            researcherId: 'RID-KKU-1',
            wosStandard: 'KARACAN UYAR, K',
            documentCount: 3,
            affiliations: [],
          },
        ],
        affiliations: [],
        publications: [],
      },
    });

    const result = await service.discoverAuthors('Kübra Karacan Uyar', 10);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      displayName: 'Kübra Karacan Uyar',
      normalizedName: 'kubra karacan uyar',
    });
    expect(result.items[0].sourceProfilesRaw).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          platform: 'clarivate_wos',
          externalAuthorId: 'RID-KKU-1',
        }),
        expect.objectContaining({
          platform: 'trdizin',
          externalAuthorId: '905080',
        }),
      ]),
    );
  });

  it('does not merge Clarivate compound-surname variants into shorter plain surname identities', () => {
    const service = createService();

    const merged = (service as any).mergeAndDeduplicate([
      createCandidate({
        displayName: 'Karacan Uyar, Kubra',
        normalizedName: 'kubra karacan uyar',
        platform: 'clarivate_wos',
        externalAuthorId: 'RID-KKU-2',
        keywords: ['kubra', 'karacan', 'uyar'],
        score: 18,
      }),
      createCandidate({
        displayName: 'Kübra Uyar',
        normalizedName: 'kubra uyar',
        platform: 'trdizin',
        externalAuthorId: '905082',
        affiliations: [
          {
            raw: 'Afyon Kocatepe Üniversitesi, Afyonkarahisar, Türkiye',
            platform: 'trdizin',
            university: 'Afyon Kocatepe Üniversitesi',
            city: 'Afyonkarahisar',
            country: 'Türkiye',
            tokens: [
              'afyon',
              'kocatepe',
              'universitesi',
              'afyonkarahisar',
              'turkiye',
            ],
          },
        ],
        university: 'Afyon Kocatepe Üniversitesi',
        city: 'Afyonkarahisar',
        country: 'Türkiye',
        score: 80,
      }),
    ]);

    expect(merged).toHaveLength(2);
    expect(merged.map((item: any) => item.displayName)).toEqual(
      expect.arrayContaining(['Karacan Uyar, Kubra', 'Kübra Uyar']),
    );
  });

  it('collapses exact same long-name duplicates when the WoS side is sparse and the other side is richer', async () => {
    const { service } = createDiscoverAuthorsService({
      dbResults: [
        {
          _id: 'db-hallac-1',
          fullName: 'Hallac, Ibrahim Riza',
          normalizedName: 'ibrahim riza hallac',
          affiliations: [
            'Ibrahim Riza Hallac. Other names Ibrahim R. HALLAC. Verified email at hiof.no',
          ],
          parsedAffiliations: [
            {
              raw: 'Ibrahim Riza Hallac. Other names Ibrahim R. HALLAC. Verified email at hiof.no',
              platform: 'serpapi_scholar',
              emailDomain: 'hiof.no',
              tokens: ['ibrahim', 'riza', 'hallac', 'hiof', 'no'],
            },
          ],
          searchKeywords: ['ibrahim', 'riza', 'hallac', 'hiof', 'no'],
          sourceProfiles: [
            {
              platform: 'serpapi_scholar',
              externalAuthorId: 'scholar-hallac-1',
            },
            {
              platform: 'clarivate_wos',
              externalAuthorId: 'RID-HALLAC-1',
            },
          ],
          institutionAliases: [],
          emailDomain: 'hiof.no',
        },
        {
          _id: 'db-hallac-2',
          fullName: 'Hallac, Ibrahim Riza',
          normalizedName: 'ibrahim riza hallac',
          affiliations: [
            'Fırat Üniversitesi, Mühendislik Fakültesi, Bilgisayar Mühendisliği Bölümü, Elazığ, Türkiye',
          ],
          parsedAffiliations: [
            {
              raw: 'Fırat Üniversitesi, Mühendislik Fakültesi, Bilgisayar Mühendisliği Bölümü, Elazığ, Türkiye',
              platform: 'trdizin',
              university: 'Fırat Üniversitesi',
              city: 'Elazığ',
              country: 'Türkiye',
              institutionCanonicalName: 'Fırat Üniversitesi',
              institutionCanonicalKey: 'firat-university',
              tokens: [
                'firat',
                'universitesi',
                'elazig',
                'turkiye',
              ],
            },
          ],
          searchKeywords: [
            'ibrahim',
            'riza',
            'hallac',
            'firat',
            'universitesi',
            'elazig',
            'turkiye',
          ],
          sourceProfiles: [
            {
              platform: 'trdizin',
              externalAuthorId: '905083',
            },
            {
              platform: 'clarivate_wos',
              externalAuthorId: 'RID-HALLAC-2',
            },
          ],
          institutionAliases: [],
          university: 'Fırat Üniversitesi',
          city: 'Elazığ',
          country: 'Türkiye',
        },
      ],
    });

    const result = await service.discoverAuthors('İbrahim Rıza Hallaç', 10);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      displayName: 'Hallac, Ibrahim Riza',
      normalizedName: 'ibrahim riza hallac',
    });
    expect(result.items[0].sourceProfilesRaw).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          platform: 'clarivate_wos',
          externalAuthorId: 'RID-HALLAC-1',
        }),
        expect.objectContaining({
          platform: 'clarivate_wos',
          externalAuthorId: 'RID-HALLAC-2',
        }),
      ]),
    );
  });

  it('collapses exact same long-name duplicates when scholar email and trdizin institution complement each other', async () => {
    const { service } = createDiscoverAuthorsService({
      dbResults: [
        {
          _id: 'db-hallac-email',
          fullName: 'Hallac, Ibrahim Riza',
          normalizedName: 'ibrahim riza hallac',
          affiliations: [
            'Ibrahim Riza Hallac. Other names Ibrahim R. HALLAC. Verified email at hiof.no',
          ],
          parsedAffiliations: [
            {
              raw: 'Ibrahim Riza Hallac. Other names Ibrahim R. HALLAC. Verified email at hiof.no',
              platform: 'serpapi_scholar',
              emailDomain: 'hiof.no',
              tokens: ['ibrahim', 'riza', 'hallac', 'hiof', 'no'],
            },
          ],
          searchKeywords: ['ibrahim', 'riza', 'hallac', 'hiof', 'no'],
          sourceProfiles: [
            {
              platform: 'serpapi_scholar',
              externalAuthorId: 'scholar-hallac-1',
            },
          ],
          institutionAliases: [],
          emailDomain: 'hiof.no',
        },
        {
          _id: 'db-hallac-trdizin',
          fullName: 'Hallac, Ibrahim Riza',
          normalizedName: 'ibrahim riza hallac',
          affiliations: [
            'Fırat Üniversitesi, Mühendislik Fakültesi, Bilgisayar Mühendisliği Bölümü, Elazığ, Türkiye',
          ],
          parsedAffiliations: [
            {
              raw: 'Fırat Üniversitesi, Mühendislik Fakültesi, Bilgisayar Mühendisliği Bölümü, Elazığ, Türkiye',
              platform: 'trdizin',
              university: 'Fırat Üniversitesi',
              city: 'Elazığ',
              country: 'Türkiye',
              institutionCanonicalName: 'Fırat Üniversitesi',
              institutionCanonicalKey: 'firat-university',
              tokens: ['firat', 'universitesi', 'elazig', 'turkiye'],
            },
          ],
          searchKeywords: [
            'ibrahim',
            'riza',
            'hallac',
            'firat',
            'universitesi',
            'elazig',
            'turkiye',
          ],
          sourceProfiles: [
            {
              platform: 'trdizin',
              externalAuthorId: '905083',
            },
          ],
          institutionAliases: [],
          university: 'Fırat Üniversitesi',
          city: 'Elazığ',
          country: 'Türkiye',
        },
      ],
    });

    const result = await service.discoverAuthors('İbrahim Rıza Hallaç', 10);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].sourceProfilesRaw).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          platform: 'serpapi_scholar',
          externalAuthorId: 'scholar-hallac-1',
        }),
        expect.objectContaining({
          platform: 'trdizin',
          externalAuthorId: '905083',
        }),
      ]),
    );
  });

  it('collapses sparse WoS surname variants into the richer DB identity for search responses', async () => {
    const { service } = createDiscoverAuthorsService({
      dbResults: [
        {
          _id: 'db-wos-1',
          fullName: 'Oztimur, Ozge',
          normalizedName: 'ozge oztimur',
          affiliations: [],
          parsedAffiliations: [],
          searchKeywords: ['ozge', 'oztimur'],
          sourceProfiles: [
            {
              platform: 'clarivate_wos',
              externalAuthorId: 'RID-OO-1',
            },
          ],
          institutionAliases: [],
        },
        {
          _id: 'db-rich-1',
          fullName: 'ÖZGE ÖZTİMUR KARADAĞ',
          normalizedName: 'ozge oztimur karadag',
          affiliations: [
            'Orta Doğu Teknik Üniversitesi, Mühendislik Fakültesi, Bilgisayar Mühendisliği Bölümü, Ankara, Türkiye',
          ],
          parsedAffiliations: [
            {
              raw: 'Orta Doğu Teknik Üniversitesi, Mühendislik Fakültesi, Bilgisayar Mühendisliği Bölümü, Ankara, Türkiye',
              platform: 'trdizin',
              university: 'Orta Doğu Teknik Üniversitesi',
              city: 'Ankara',
              country: 'Türkiye',
              tokens: [
                'orta',
                'dogu',
                'teknik',
                'universitesi',
                'ankara',
                'turkiye',
              ],
            },
          ],
          searchKeywords: [
            'ozge',
            'oztimur',
            'karadag',
            'orta',
            'dogu',
            'teknik',
            'universitesi',
            'ankara',
            'turkiye',
          ],
          sourceProfiles: [
            {
              platform: 'serpapi_scholar',
              externalAuthorId: 'scholar-ozge-1',
            },
            {
              platform: 'trdizin',
              externalAuthorId: '905081',
            },
            {
              platform: 'scraper_scopus',
              externalAuthorId: '572001',
            },
          ],
          institutionAliases: [],
          university: 'Orta Doğu Teknik Üniversitesi',
          city: 'Ankara',
          country: 'Türkiye',
          emailDomain: 'metu.edu.tr',
        },
      ],
    });

    const result = await service.discoverAuthors('Özge Öztimur', 10);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      displayName: 'ÖZGE ÖZTİMUR KARADAĞ',
      normalizedName: 'ozge oztimur karadag',
      dbAuthorId: 'db-rich-1',
    });
    expect(result.items[0].sourceProfilesRaw).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          platform: 'clarivate_wos',
          externalAuthorId: 'RID-OO-1',
        }),
        expect.objectContaining({
          platform: 'serpapi_scholar',
          externalAuthorId: 'scholar-ozge-1',
        }),
      ]),
    );
  });

  it('does not merge exact same-name candidates when institution evidence conflicts', () => {
    const service = createService();

    const merged = (service as any).mergeAndDeduplicate([
      createCandidate({
        displayName: 'Kübra Uyar',
        normalizedName: 'kubra uyar',
        platform: 'serpapi_scholar',
        externalAuthorId: 'FJ3IvCgAAAAJ',
        affiliations: [
          {
            raw: 'Alanya Alaaddin Keykubat University, Antalya, Türkiye',
            platform: 'serpapi_scholar',
            university: 'Alanya Alaaddin Keykubat Üniversitesi',
            city: 'Antalya',
            country: 'Türkiye',
            emailDomain: 'alanya.edu.tr',
            tokens: [
              'alanya',
              'alaaddin',
              'keykubat',
              'university',
              'antalya',
              'turkiye',
            ],
          },
        ],
        university: 'Alanya Alaaddin Keykubat Üniversitesi',
        city: 'Antalya',
        country: 'Türkiye',
        score: 95,
      }),
      createCandidate({
        displayName: 'Kübra Uyar',
        normalizedName: 'kubra uyar',
        platform: 'trdizin',
        externalAuthorId: '1027335',
        affiliations: [
          {
            raw: 'Afyon Kocatepe Üniversitesi, Afyonkarahisar, Türkiye',
            platform: 'trdizin',
            university: 'Afyon Kocatepe Üniversitesi',
            city: 'Afyonkarahisar',
            country: 'Türkiye',
            tokens: [
              'afyon',
              'kocatepe',
              'universitesi',
              'afyonkarahisar',
              'turkiye',
            ],
          },
        ],
        university: 'Afyon Kocatepe Üniversitesi',
        city: 'Afyonkarahisar',
        country: 'Türkiye',
        score: 92,
      }),
    ]);

    expect(merged).toHaveLength(2);
    expect(
      merged.flatMap((item: any) =>
        item.sourceProfiles.map((profile: any) => profile.externalAuthorId),
      ),
    ).toEqual(expect.arrayContaining(['FJ3IvCgAAAAJ', '1027335']));
  });

  it('deduplicates DB-first results when abbreviated PubMed rows and richer canonical rows represent the same author', async () => {
    const { service } = createDiscoverAuthorsService({
      dbResults: [
        {
          _id: 'db-1',
          fullName: 'Arslan E',
          normalizedName: 'arslan e',
          affiliations: [],
          parsedAffiliations: [],
          searchKeywords: ['arslan', 'e'],
          sourceProfiles: [
            {
              platform: 'scraper_pubmed',
              externalAuthorId: 'arslan e',
            },
          ],
          institutionAliases: [],
        },
        {
          _id: 'db-2',
          fullName: 'Arslan, Enis',
          normalizedName: 'enis arslan',
          affiliations: [],
          parsedAffiliations: [],
          searchKeywords: ['enis', 'arslan'],
          sourceProfiles: [
            {
              platform: 'scraper_pubmed',
              externalAuthorId: 'enis arslan',
            },
          ],
          institutionAliases: [],
        },
        {
          _id: 'db-3',
          fullName: 'Adil Enis Arslan',
          normalizedName: 'adil enis arslan',
          affiliations: [
            'Enis Arslan. Alanya Alaaddin Keykubat University. Verified email at alanya.edu.tr',
          ],
          parsedAffiliations: [],
          searchKeywords: ['adil', 'enis', 'arslan', 'alanya', 'alaaddin', 'keykubat'],
          sourceProfiles: [
            {
              platform: 'serpapi_scholar',
              externalAuthorId: 'scholar-arslan-1',
            },
            {
              platform: 'scraper_pubmed',
              externalAuthorId: 'arslan-enis-rich',
            },
          ],
          institutionAliases: [],
        },
      ],
    });

    const result = await service.discoverAuthors('Enis Arslan', 10);

    expect(result.source).toBe('db_plus_providers');
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      displayName: 'Adil Enis Arslan',
      normalizedName: 'adil enis arslan',
      dbAuthorId: 'db-3',
    });
    expect(result.items[0].sourceProfiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          platform: 'PubMed',
          platformKey: 'pubmed',
        }),
        expect.objectContaining({
          platform: 'Google Scholar',
          platformKey: 'google_scholar',
        }),
      ]),
    );
    expect(result.items[0].sourceProfilesRaw).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          platform: 'scraper_pubmed',
          externalAuthorId: 'arslan e',
        }),
        expect.objectContaining({
          platform: 'scraper_pubmed',
          externalAuthorId: 'enis arslan',
        }),
        expect.objectContaining({
          platform: 'scraper_pubmed',
          externalAuthorId: 'arslan-enis-rich',
        }),
        expect.objectContaining({
          platform: 'serpapi_scholar',
          externalAuthorId: 'scholar-arslan-1',
        }),
      ]),
    );
    expect(result.items[0].sourcePlatforms).toEqual(
      expect.arrayContaining(['PubMed', 'Google Scholar']),
    );
  });

  it('backfills provider results when DB has too few relevant author matches and drops weak DB noise', async () => {
    const { service, serpapiService, trdizinService, scraperService } =
      createDiscoverAuthorsService({
        dbResults: [
          {
            _id: 'db-1',
            fullName: 'Enis Arslan',
            normalizedName: 'enis arslan',
            affiliations: ['Istanbul Technical University, Istanbul, Türkiye'],
            parsedAffiliations: [],
            searchKeywords: ['enis', 'arslan', 'istanbul', 'technical', 'university'],
            sourceProfiles: [
              {
                platform: 'trdizin',
                externalAuthorId: 'db-enis-1',
              },
            ],
            institutionAliases: [],
          },
          {
            _id: 'db-2',
            fullName: 'Figen Basaran Demirkazik',
            normalizedName: 'figen basaran demirkazik',
            affiliations: ['Hacettepe University, Ankara, Türkiye'],
            parsedAffiliations: [],
            searchKeywords: ['figen', 'basaran', 'demirkazik', 'hacettepe'],
            sourceProfiles: [
              {
                platform: 'trdizin',
                externalAuthorId: 'db-figen-1',
              },
            ],
            institutionAliases: [],
          },
        ],
        serpapiAuthors: [
          {
            name: 'Enis Arslan Kaya',
            normalizedName: 'enis arslan kaya',
            affiliation: 'Istanbul Technical University, Istanbul, Türkiye',
            author_id: 'scholar-enis-kaya',
            score: 86,
          },
        ],
        trdizinAuthors: [
          {
            authorId: 'trdizin-adil-enis',
            displayName: 'Adil Enis Arslan',
            normalizedName: 'adil enis arslan',
            affiliations: [
              'Department of Computer Engineering, Hacettepe University, Ankara, Türkiye',
            ],
            score: 82,
          },
        ],
      });

    const result = await service.discoverAuthors('Enis Arslan', 10);

    expect(result.source).toBe('db_plus_providers');
    expect(serpapiService.searchAuthorsNormalized).toHaveBeenCalled();
    expect(trdizinService.searchAuthorsNormalized).toHaveBeenCalled();
    expect(scraperService.searchScopusAuthors).toHaveBeenCalled();
    expect(scraperService.searchPubmedAuthor).toHaveBeenCalled();
    expect(result.items.map((item) => item.displayName)).toEqual(
      expect.arrayContaining([
        'Enis Arslan',
        'Enis Arslan Kaya',
        'Adil Enis Arslan',
      ]),
    );
    expect(result.items.map((item) => item.displayName)).not.toContain(
      'Figen Basaran Demirkazik',
    );
  });

  it('keeps the exact DB identity separate from longer same-surname variants', async () => {
    const { service } = createDiscoverAuthorsService({
      dbResults: [
        {
          _id: 'db-1',
          fullName: 'Arslan, Enis',
          normalizedName: 'enis arslan',
          affiliations: ['Çanakkale Onsekiz Mart Üniversitesi, Çanakkale, Türkiye'],
          parsedAffiliations: [],
          searchKeywords: ['enis', 'arslan', 'canakkale', 'onsekiz', 'mart'],
          sourceProfiles: [
            {
              platform: 'trdizin',
              externalAuthorId: 'db-enis-exact',
            },
          ],
          institutionAliases: [],
          university: 'Çanakkale Onsekiz Mart Üniversitesi',
          city: 'Çanakkale',
          country: 'Türkiye',
          emailDomain: 'alanya.edu.tr',
        },
      ],
      serpapiAuthors: [
        {
          name: 'ADİL ENİS ARSLAN',
          normalizedName: 'adil enis arslan',
          affiliation: 'İstanbul Teknik Üniversitesi. Verified email at itu.edu.tr',
          author_id: 'scholar-adil-enis',
          score: 88,
        },
      ],
    });

    const result = await service.discoverAuthors('Enis Arslan', 10);

    expect(result.items.map((item) => item.displayName)).toEqual(
      expect.arrayContaining(['Arslan, Enis', 'ADİL ENİS ARSLAN']),
    );
  });

  it('does not merge same-surname variants when universities and email domains conflict', () => {
    const service = createService();

    const merged = (service as any).mergeResponseCandidates([
      {
        ...createCandidate({
          displayName: 'Arslan, Enis',
          normalizedName: 'enis arslan',
          platform: 'trdizin',
          externalAuthorId: 'enis-1',
          affiliationRaw: [
            'Çanakkale Onsekiz Mart Üniversitesi, Bilgisayar Mühendisliği Bölümü, Çanakkale, Türkiye',
          ],
          university: 'Çanakkale Onsekiz Mart Üniversitesi',
          city: 'Çanakkale',
          country: 'Türkiye',
          score: 100,
        }),
        dbAuthorId: 'db-enis',
        dbStatus: 'existing',
        dbMatchScore: 1,
      },
      {
        ...createCandidate({
          displayName: 'Adil Enis Arslan',
          normalizedName: 'adil enis arslan',
          platform: 'serpapi_scholar',
          externalAuthorId: 'adil-1',
          affiliationRaw: [
            'İstanbul Teknik Üniversitesi. Verified email at itu.edu.tr',
          ],
          university: 'İstanbul Teknik Üniversitesi',
          city: 'İstanbul',
          country: 'Türkiye',
          score: 85,
        }),
        dbAuthorId: 'db-adil',
        dbStatus: 'existing',
        dbMatchScore: 0.85,
      },
    ]);

    expect(merged).toHaveLength(2);
    expect(merged.map((item: any) => item.displayName)).toEqual(
      expect.arrayContaining(['Arslan, Enis', 'Adil Enis Arslan']),
    );
  });

  it('keeps one canonical school label while matching provider-specific aliases', () => {
    const service = createService();

    const merged = (service as any).mergeAndDeduplicate([
      createCandidate({
        displayName: 'Yılmaz Kemal Yüce',
        normalizedName: 'yilmaz kemal yuce',
        platform: 'trdizin',
        externalAuthorId: '905079',
        affiliations: [
          {
            raw: 'Alanya Alaaddin Keykubat Üniversitesi',
            platform: 'trdizin',
            university: 'Alanya Alaaddin Keykubat Üniversitesi',
            tokens: ['alanya', 'alaaddin', 'keykubat', 'universitesi'],
          },
        ],
        affiliationRaw: ['Alanya Alaaddin Keykubat Üniversitesi'],
        university: 'Alanya Alaaddin Keykubat Üniversitesi',
        score: 98,
      }),
      createCandidate({
        displayName: 'Yılmaz Kemal Yüce',
        normalizedName: 'yilmaz kemal yuce',
        platform: 'scraper_scopus',
        externalAuthorId: '18635626400',
        affiliations: [
          {
            raw: 'Alanya Alku Üniversitesi',
            platform: 'scraper_scopus',
            university: 'Alanya Alku Üniversitesi',
            tokens: ['alanya', 'alku', 'universitesi'],
          },
        ],
        affiliationRaw: ['Alanya Alku Üniversitesi'],
        university: 'Alanya Alku Üniversitesi',
        score: 85,
      }),
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].searchIndex.university).toBe(
      'Alanya Alaaddin Keykubat Üniversitesi',
    );
    expect(merged[0].searchIndex.institutionAliases).toContain(
      'Alanya Alku Üniversitesi',
    );

    const matchesCanonicalFilter = (service as any).matchesRequestedFilters(
      merged[0],
      {
        institution: 'inst-alku',
      },
    );

    expect(matchesCanonicalFilter).toBe(true);
  });

  it('collapses equivalent school aliases into a single filter option', async () => {
    const service = new DiscoveryService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {
        listInstitutionFilterSeeds: async () => [
          {
            canonicalName: 'Alanya Alaaddin Keykubat Üniversitesi',
            normalizedKey: 'inst-alku',
            city: 'Antalya',
            country: 'Türkiye',
            authorCount: 2,
            aliases: ['Alanya Alku Üniversitesi'],
            manualAliases: ['ALKÜ'],
            platformAliases: [
              {
                platform: 'scraper_scopus',
                names: ['Alanya Alku Üniversitesi'],
              },
            ],
          },
        ],
      } as never,
      {} as never,
    );

    const filters = await service.getAuthorFilters();

    const schoolLabels = filters.schools.map((item: { label: string }) => item.label);
    expect(schoolLabels).toContain('Alanya Alaaddin Keykubat Üniversitesi');
    expect(
      schoolLabels.filter((label: string) => /alku|alaaddin keykubat/i.test(label)),
    ).toHaveLength(1);
    expect(filters.schools.find((item: { label: string }) => item.label === 'Alanya Alaaddin Keykubat Üniversitesi'))
      .toMatchObject({
        value: 'inst-alku',
        count: 2,
      });
  });

  it('keeps PubMed-style DB initials matches relevant for full-name queries', async () => {
    const { service } = createDiscoverAuthorsService({
      dbResults: [
        {
          _id: 'db-yk-1',
          fullName: 'Yuce YK',
          normalizedName: 'yuce yk',
          affiliations: [
            'Department of Computer Engineering, Alanya Alaaddin Keykubat University, Antalya, Türkiye',
          ],
          parsedAffiliations: [],
          searchKeywords: [
            'yuce',
            'yk',
            'computer',
            'engineering',
            'alanya',
            'alaaddin',
            'keykubat',
            'antalya',
            'turkiye',
          ],
          sourceProfiles: [
            {
              platform: 'scraper_pubmed',
              externalAuthorId: 'yuce yk',
            },
          ],
          institutionAliases: [],
        },
      ],
    });

    const result = await service.discoverAuthors('Yılmaz Kemal Yüce', 10);

    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          displayName: 'Yuce YK',
          dbAuthorId: 'db-yk-1',
        }),
      ]),
    );
  });
});
