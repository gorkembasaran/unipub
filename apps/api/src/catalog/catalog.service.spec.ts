import { areInstitutionNamesEquivalent } from '../common/institution-normalization';
import { CatalogService } from './catalog.service';

describe('CatalogService author canonical naming', () => {
  class FakeAuthorDoc {
    _id = 'author-1';
    fullName = '';
    normalizedName = '';
    aliases: string[] = [];
    affiliations: string[] = [];
    parsedAffiliations: Array<Record<string, unknown>> = [];
    searchKeywords: string[] = [];
    sourceProfiles: Array<Record<string, unknown>> = [];
    institutionId?: string;
    institutionCanonicalKey?: string;
    institutionAliases: string[] = [];
    university?: string;
    city?: string;
    country?: string;
    emailDomain?: string;

    constructor(input: Record<string, unknown>) {
      Object.assign(this, input);
    }

    async save() {
      return this;
    }

    toObject() {
      return {
        _id: this._id,
        fullName: this.fullName,
        normalizedName: this.normalizedName,
        aliases: [...this.aliases],
        affiliations: [...this.affiliations],
        parsedAffiliations: [...this.parsedAffiliations],
        searchKeywords: [...this.searchKeywords],
        sourceProfiles: [...this.sourceProfiles],
        institutionId: this.institutionId,
        institutionCanonicalKey: this.institutionCanonicalKey,
        institutionAliases: [...this.institutionAliases],
        university: this.university,
        city: this.city,
        country: this.country,
        emailDomain: this.emailDomain,
      };
    }
  }

  class FakeInstitutionDoc {
    _id = 'institution-1';
    canonicalName = '';
    normalizedKey = '';
    aliases: string[] = [];
    manualAliases: string[] = [];
    matchKeys: string[] = [];
    platformAliases: Array<Record<string, unknown>> = [];
    canonicalLocked = false;
    city?: string;
    country?: string;

    constructor(input: Record<string, unknown>) {
      Object.assign(this, input);
    }

    async save() {
      return this;
    }

    toObject() {
      return {
        _id: this._id,
        canonicalName: this.canonicalName,
        normalizedKey: this.normalizedKey,
        aliases: [...this.aliases],
        manualAliases: [...this.manualAliases],
        matchKeys: [...this.matchKeys],
        platformAliases: [...this.platformAliases],
        canonicalLocked: this.canonicalLocked,
        city: this.city,
        country: this.country,
      };
    }
  }

  function createService(
    existingDocs: Array<Record<string, unknown>> = [],
    existingInstitutions: Array<Record<string, unknown>> = [],
  ) {
    const docs = existingDocs.map((doc, index) =>
      new FakeAuthorDoc({
        _id: `author-${index + 1}`,
        aliases: [],
        affiliations: [],
        parsedAffiliations: [],
        searchKeywords: [],
        sourceProfiles: [],
        institutionAliases: [],
        ...doc,
      }),
    );
    const institutions: FakeInstitutionDoc[] = existingInstitutions.map(
      (doc, index) =>
        new FakeInstitutionDoc({
          _id: `institution-${index + 1}`,
          aliases: [],
          manualAliases: [],
          matchKeys: [],
          platformAliases: [],
          ...doc,
        }),
    );

    const matches = (
      doc: FakeAuthorDoc,
      query: Record<string, unknown>,
    ): boolean => {
      if ('$or' in query && Array.isArray(query.$or)) {
        return query.$or.some((entry) => matches(doc, entry));
      }

      if ('$and' in query && Array.isArray(query.$and)) {
        return query.$and.every((entry) => matches(doc, entry));
      }

      if ('normalizedName' in query) {
        if (query.normalizedName instanceof RegExp) {
          return query.normalizedName.test(doc.normalizedName);
        }
        return doc.normalizedName === query.normalizedName;
      }

      if ('fullName' in query) {
        if (query.fullName instanceof RegExp) {
          return query.fullName.test(doc.fullName);
        }
        return doc.fullName === query.fullName;
      }

      if ('aliases' in query) {
        const aliasesQuery = query.aliases;
        if (aliasesQuery instanceof RegExp) {
          return doc.aliases.some((alias) => aliasesQuery.test(alias));
        }
        return doc.aliases.includes(String(aliasesQuery));
      }

      if (
        'searchKeywords' in query &&
        query.searchKeywords &&
        typeof query.searchKeywords === 'object' &&
        '$all' in (query.searchKeywords as Record<string, unknown>)
      ) {
        const tokens = (query.searchKeywords as { $all: string[] }).$all;
        return tokens.every((token) => doc.searchKeywords.includes(token));
      }

      const sourceProfiles = query.sourceProfiles as
        | { $elemMatch?: { platform?: string; externalAuthorId?: string } }
        | undefined;
      const elemMatch = sourceProfiles?.$elemMatch;
      if (elemMatch) {
        return doc.sourceProfiles.some(
          (profile) =>
            profile.platform === elemMatch.platform &&
            profile.externalAuthorId === elemMatch.externalAuthorId,
        );
      }

      return false;
    };

    class FakeAuthorModel extends FakeAuthorDoc {
      static find(query?: Record<string, unknown>) {
        const filtered = query ? docs.filter((doc) => matches(doc, query)) : docs;
        return {
          limit(limit: number) {
            return {
              exec: async () => filtered.slice(0, limit),
            };
          },
          exec: async () => filtered,
        };
      }

      static aggregate() {
        return {
          exec: async () => {
            const counts = new Map<string, number>();
            for (const doc of docs) {
              const key = doc.institutionCanonicalKey;
              if (!key) {
                continue;
              }
              counts.set(key, (counts.get(key) ?? 0) + 1);
            }

            return Array.from(counts.entries()).map(([key, count]) => ({
              _id: key,
              count,
            }));
          },
        };
      }

      static findOne(query: Record<string, unknown>) {
        return {
          exec: async () => docs.find((doc) => matches(doc, query)) ?? null,
        };
      }

      constructor(input: Record<string, unknown>) {
        super(input);
        docs.push(this);
      }
    }

    class FakeInstitutionModel extends FakeInstitutionDoc {
      static countDocuments() {
        return {
          exec: async () => institutions.length,
        };
      }

      static find() {
        return {
          sort() {
            return {
              lean() {
                return {
                  exec: async () => institutions.map((doc) => doc.toObject()),
                };
              },
            };
          },
        };
      }

      static deleteMany() {
        return {
          exec: async () => {
            institutions.splice(0, institutions.length);
          },
        };
      }

      static findOne(query: Record<string, unknown>) {
        return {
          exec: async () =>
            institutions.find((doc) => {
              if (
                query.normalizedKey &&
                doc.normalizedKey === query.normalizedKey
              ) {
                return true;
              }

              if ('$or' in query && Array.isArray(query.$or)) {
                return query.$or.some((entry) => {
                  if (
                    entry.normalizedKey &&
                    doc.normalizedKey === entry.normalizedKey
                  ) {
                    return true;
                  }

                  if (
                    entry.matchKeys?.$in &&
                    Array.isArray(entry.matchKeys.$in) &&
                    entry.matchKeys.$in.some((key: string) =>
                      doc.matchKeys.includes(key),
                    )
                  ) {
                    return true;
                  }

                  if (
                    entry.canonicalName?.$in &&
                    Array.isArray(entry.canonicalName.$in) &&
                    entry.canonicalName.$in.includes(doc.canonicalName)
                  ) {
                    return true;
                  }

                  if (
                    entry.aliases?.$in &&
                    Array.isArray(entry.aliases.$in) &&
                    entry.aliases.$in.some((alias: string) =>
                      doc.aliases.includes(alias),
                    )
                  ) {
                    return true;
                  }

                  if (
                    entry.manualAliases?.$in &&
                    Array.isArray(entry.manualAliases.$in) &&
                    entry.manualAliases.$in.some((alias: string) =>
                      doc.manualAliases.includes(alias),
                    )
                  ) {
                    return true;
                  }

                  return false;
                });
              }

              return false;
            }) ?? null,
        };
      }

      constructor(input: Record<string, unknown>) {
        super({
          _id: `institution-${institutions.length + 1}`,
          aliases: [],
          manualAliases: [],
          matchKeys: [],
          platformAliases: [],
          ...input,
        });
        institutions.push(this);
      }
    }

    const service = new CatalogService(
      FakeAuthorModel as never,
      FakeInstitutionModel as never,
      {} as never,
    );

    return { service, docs, institutions };
  }

  it('builds a non-repeating profile summary from structured author affiliation fields', () => {
    const { service } = createService();

    const result = (service as any).formatAuthorOutput({
      _id: 'author-structured',
      fullName: 'Yılmaz Kemal Yüce',
      affiliations: [
        'Dr. Yılmaz Kemal Yuce, Asst.Prof., Dept. of Computer Engineering, Faculty of Engineering, Alanya Alaaddin Keykubat. Verified email at alanya.edu.tr',
      ],
      parsedAffiliations: [
        {
          personTitle: 'Dr.',
          role: 'Asst.Prof.',
          department: 'Department of Computer Engineering',
          faculty: 'Faculty of Engineering',
          university: 'Alanya Alaaddin Keykubat University',
          city: 'Alanya',
          country: 'Türkiye',
          emailDomain: 'alanya.edu.tr',
        },
        {
          department: 'Department of Computer Engineering',
          university: 'Alanya Alaaddin Keykubat University',
          city: 'Alanya',
          country: 'Türkiye',
        },
      ],
      university: 'Alanya Alaaddin Keykubat University',
      city: 'Alanya',
      country: 'Türkiye',
      emailDomain: 'alanya.edu.tr',
      sourceProfiles: [],
      institutionAliases: [],
    });

    expect(result.profile).toMatchObject({
      institutionName: 'Alanya Alaaddin Keykubat University',
      title: 'Dr., Asst.Prof.',
      emailDomain: 'alanya.edu.tr',
      faculty: 'Faculty of Engineering',
      country: 'Türkiye',
      city: 'Alanya',
      department: 'Department of Computer Engineering',
    });
    expect(result.profileSummaryParts).toEqual([
      'Alanya Alaaddin Keykubat University',
      'Dr., Asst.Prof.',
      'Verified email: alanya.edu.tr',
      'Faculty of Engineering',
      'Türkiye',
      'Alanya',
      'Department of Computer Engineering',
    ]);
  });

  it('prefers raw affiliation institutions over polluted canonical university output', () => {
    const { service } = createService();

    const result = (service as any).formatAuthorOutput({
      _id: 'author-adem',
      fullName: 'Adem TEKİN',
      affiliations: [
        'Adem Tekin. Istanbul Technical University. Verified email at itu.edu.tr - Homepage',
        'İstanbul Teknik Üniversitesi, Bilişim Enstitüsü, İstanbul, Türkiye',
      ],
      parsedAffiliations: [
        {
          raw: 'Adem Tekin. Istanbul Technical University. Verified email at itu.edu.tr - Homepage',
          university: 'Alanya Alaaddin Keykubat Üniversitesi',
          institutionCanonicalName: 'Alanya Alaaddin Keykubat Üniversitesi',
          emailDomain: 'itu.edu.tr',
          platform: 'serpapi_scholar',
        },
        {
          raw: 'İstanbul Teknik Üniversitesi, Bilişim Enstitüsü, İstanbul, Türkiye',
          university: 'Alanya Alaaddin Keykubat Üniversitesi',
          institutionCanonicalName: 'Alanya Alaaddin Keykubat Üniversitesi',
          city: 'İstanbul',
          country: 'Türkiye',
          platform: 'trdizin',
        },
      ],
      university: 'Alanya Alaaddin Keykubat Üniversitesi',
      city: 'Antalya',
      country: 'Türkiye',
      emailDomain: 'itu.edu.tr',
      institutionAliases: [
        'Istanbul Technical University',
        'İstanbul Teknik Üniversitesi',
      ],
      sourceProfiles: [],
    });

    expect(
      areInstitutionNamesEquivalent(
        result.university,
        'Istanbul Technical University',
      ),
    ).toBe(true);
    expect(result.profile.institutionName).toBe(result.university);
    expect(result.profileSummaryParts[0]).toBe(result.university);
    expect(result.city).toBe('İstanbul');
    expect(result.profile.city).toBe('İstanbul');
  });

  it('upgrades abbreviated PubMed author names to richer canonical full names and keeps aliases', async () => {
    const { service, docs } = createService([
      {
        fullName: 'Yuce YK',
        normalizedName: 'yuce yk',
        sourceProfiles: [
          {
            platform: 'scraper_pubmed',
            externalAuthorId: 'yuce yk',
            profileUrl: 'https://pubmed.ncbi.nlm.nih.gov/?term=yuce%20yk%5BAuthor%5D',
            score: 20,
          },
        ],
      },
    ]);

    const result = await service.upsertDiscoveredAuthor({
      displayName: 'Yılmaz Kemal Yüce',
      normalizedName: 'yilmaz kemal yuce',
      affiliationRaw: ['Firat Universitesi, Elazig, Turkiye'],
      parsedAffiliations: [],
      searchKeywords: ['yilmaz', 'kemal', 'yuce', 'firat', 'elazig'],
      university: 'Firat Universitesi',
      city: 'Elazig',
      country: 'Turkiye',
      sourceProfiles: [
        {
          platform: 'scraper_pubmed',
          externalAuthorId: 'yuce yk',
          profileUrl: 'https://pubmed.ncbi.nlm.nih.gov/?term=yuce%20yk%5BAuthor%5D',
          score: 20,
        },
        {
          platform: 'trdizin',
          externalAuthorId: '905079',
          profileUrl: 'https://search.trdizin.gov.tr/tr/yayin/ara?q=Y%C4%B1lmaz%20Kemal%20Y%C3%BCce',
          score: 98,
        },
      ],
    });

    expect(docs).toHaveLength(1);
    expect(docs[0].fullName).toBe('Yılmaz Kemal Yüce');
    expect(docs[0].normalizedName).toBe('yilmaz kemal yuce');
    expect(docs[0].aliases).toEqual(expect.arrayContaining(['Yuce YK']));
    expect(docs[0].university).toBe('Firat Universitesi');
    expect(docs[0].institutionAliases).toEqual([]);
    expect(docs[0].sourceProfiles).toEqual(
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
    expect(
      (result.author as { fullName?: string }).fullName,
    ).toBe('Yılmaz Kemal Yüce');
    expect(result.author.institution).toMatchObject({
      name: 'Firat Universitesi',
      canonicalKey: 'firat-university',
      aliases: [],
    });
  });

  it('merges polluted provider display names into an existing canonical author identity', async () => {
    const { service, docs } = createService([
      {
        fullName: 'EMRAH IRMAK - Google Akademik',
        normalizedName: 'emrah irmak google akademik',
        aliases: [],
        affiliations: [
          'EMRAH IRMAK. Alanya Alaaddin Keykubat Üniversitesinde Doç. Dr. alanya.edu.tr üzerinde doğrulanmış e-posta adresine sahip.',
        ],
        parsedAffiliations: [],
        searchKeywords: ['emrah', 'irmak', 'alanya', 'alaaddin', 'keykubat'],
        sourceProfiles: [
          {
            platform: 'serpapi_scholar',
            externalAuthorId: 'scholar-emrah-1',
          },
        ],
        university: 'Alanya Alaaddin Keykubat University',
        city: 'Antalya',
        country: 'Türkiye',
        emailDomain: 'alanya.edu.tr',
      },
    ]);

    const result = await service.upsertDiscoveredAuthor({
      displayName: 'Emrah Irmak',
      normalizedName: 'emrah irmak',
      affiliationRaw: [
        'Gaziantep Üniversitesi, Mühendislik Fakültesi, Elektrik Elektronik Mühendisliği Bölümü, Gaziantep, Türkiye',
      ],
      parsedAffiliations: [
        {
          raw: 'Gaziantep Üniversitesi, Mühendislik Fakültesi, Elektrik Elektronik Mühendisliği Bölümü, Gaziantep, Türkiye',
          platform: 'trdizin',
          university: 'Gaziantep Üniversitesi',
          city: 'Gaziantep',
          country: 'Türkiye',
        },
      ],
      searchKeywords: ['emrah', 'irmak', 'gaziantep', 'universitesi'],
      university: 'Gaziantep Üniversitesi',
      city: 'Gaziantep',
      country: 'Türkiye',
      sourceProfiles: [
        {
          platform: 'trdizin',
          externalAuthorId: '905080',
          score: 88,
        },
      ],
    });

    expect(docs).toHaveLength(1);
    expect(docs[0].fullName).toBe('Emrah Irmak');
    expect(docs[0].normalizedName).toBe('emrah irmak');
    expect(docs[0].aliases).toEqual(
      expect.arrayContaining(['EMRAH IRMAK - Google Akademik']),
    );
    expect(docs[0].sourceProfiles).toEqual(
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
    expect((result.author as { fullName?: string }).fullName).toBe(
      'Emrah Irmak',
    );
  });

  it('does not attach a conflicting stable-platform profile to an existing author', async () => {
    const { service, docs } = createService([
      {
        fullName: 'Kübra Uyar',
        normalizedName: 'kubra uyar',
        aliases: [],
        affiliations: ['Alanya Alaaddin Keykubat Üniversitesi, Antalya, Türkiye'],
        parsedAffiliations: [],
        searchKeywords: ['kubra', 'uyar', 'alanya', 'alaaddin', 'keykubat'],
        sourceProfiles: [
          {
            platform: 'trdizin',
            externalAuthorId: '1027335',
          },
        ],
        university: 'Alanya Alaaddin Keykubat Üniversitesi',
        city: 'Antalya',
        country: 'Türkiye',
      },
    ]);

    await service.upsertDiscoveredAuthor({
      displayName: 'Fatma Kübra Uyar',
      normalizedName: 'fatma kubra uyar',
      affiliationRaw: ['Amasya Üniversitesi, Amasya, Türkiye'],
      parsedAffiliations: [
        {
          raw: 'Amasya Üniversitesi, Amasya, Türkiye',
          platform: 'trdizin',
          university: 'Amasya Üniversitesi',
          city: 'Amasya',
          country: 'Türkiye',
        },
      ],
      searchKeywords: ['fatma', 'kubra', 'uyar', 'amasya', 'universitesi'],
      university: 'Amasya Üniversitesi',
      city: 'Amasya',
      country: 'Türkiye',
      sourceProfiles: [
        {
          platform: 'trdizin',
          externalAuthorId: '1004553',
          score: 77,
        },
      ],
    });

    expect(docs).toHaveLength(2);
    expect(docs[0].sourceProfiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          platform: 'trdizin',
          externalAuthorId: '1027335',
        }),
      ]),
    );
    expect(docs[0].sourceProfiles).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          platform: 'trdizin',
          externalAuthorId: '1004553',
        }),
      ]),
    );
    expect(docs[1].fullName).toBe('Fatma Kübra Uyar');
    expect(docs[1].sourceProfiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          platform: 'trdizin',
          externalAuthorId: '1004553',
        }),
      ]),
    );
  });

  it('does not merge exact same-name discovered authors when institution evidence conflicts', async () => {
    const { service, docs } = createService([
      {
        fullName: 'Kübra Uyar',
        normalizedName: 'kubra uyar',
        aliases: [],
        affiliations: [
          'Alanya Alaaddin Keykubat University (ALKU). Verified email at alanya.edu.tr',
        ],
        parsedAffiliations: [
          {
            raw: 'Alanya Alaaddin Keykubat University (ALKU). Verified email at alanya.edu.tr',
            platform: 'serpapi_scholar',
            university: 'Alanya Alaaddin Keykubat Üniversitesi',
            city: 'Antalya',
            country: 'Türkiye',
            emailDomain: 'alanya.edu.tr',
            tokens: [
              'alanya',
              'alaaddin',
              'keykubat',
              'alku',
              'verified',
              'email',
              'edu',
              'tr',
            ],
          },
        ],
        searchKeywords: ['kubra', 'uyar', 'alanya', 'alaaddin', 'keykubat', 'alku'],
        sourceProfiles: [
          {
            platform: 'serpapi_scholar',
            externalAuthorId: 'FJ3IvCgAAAAJ',
          },
        ],
        university: 'Alanya Alaaddin Keykubat Üniversitesi',
        city: 'Antalya',
        country: 'Türkiye',
        emailDomain: 'alanya.edu.tr',
      },
    ]);

    await service.upsertDiscoveredAuthor({
      displayName: 'Kübra Uyar',
      normalizedName: 'kubra uyar',
      affiliationRaw: ['Afyon Kocatepe Üniversitesi, Afyonkarahisar, Türkiye'],
      parsedAffiliations: [
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
      searchKeywords: ['kubra', 'uyar', 'afyon', 'kocatepe', 'universitesi'],
      university: 'Afyon Kocatepe Üniversitesi',
      city: 'Afyonkarahisar',
      country: 'Türkiye',
      sourceProfiles: [
        {
          platform: 'trdizin',
          externalAuthorId: '1027335',
          score: 80,
        },
      ],
    });

    expect(docs).toHaveLength(2);
    expect(docs[0].sourceProfiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          platform: 'serpapi_scholar',
          externalAuthorId: 'FJ3IvCgAAAAJ',
        }),
      ]),
    );
    expect(docs[0].sourceProfiles).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          platform: 'trdizin',
          externalAuthorId: '1027335',
        }),
      ]),
    );
    expect(docs[1].sourceProfiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          platform: 'trdizin',
          externalAuthorId: '1027335',
        }),
      ]),
    );
    expect(docs[1].university).toBe('Afyon Kocatepe Üniversitesi');
  });

  it('merges exact same long-name discovered authors when scholar and institutional signals complement each other', async () => {
    const { service, docs } = createService([
      {
        fullName: 'Ibrahim Riza Hallac',
        normalizedName: 'ibrahim riza hallac',
        aliases: [
          'Ibrahim Riza Hallac. Other names Ibrahim R. HALLAC. Verified email at hiof.no',
        ],
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
        emailDomain: 'hiof.no',
      },
    ]);

    await service.upsertDiscoveredAuthor({
      displayName: 'Hallac, Ibrahim Riza',
      normalizedName: 'ibrahim riza hallac',
      affiliationRaw: [
        'Fırat Üniversitesi, Mühendislik Fakültesi, Bilgisayar Mühendisliği Bölümü, Elazığ, Türkiye',
      ],
      parsedAffiliations: [
        {
          raw: 'Fırat Üniversitesi, Mühendislik Fakültesi, Bilgisayar Mühendisliği Bölümü, Elazığ, Türkiye',
          platform: 'trdizin',
          university: 'Fırat Üniversitesi',
          city: 'Elazığ',
          country: 'Türkiye',
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
      university: 'Fırat Üniversitesi',
      city: 'Elazığ',
      country: 'Türkiye',
      sourceProfiles: [
        {
          platform: 'trdizin',
          externalAuthorId: '905083',
          score: 88,
        },
      ],
    });

    expect(docs).toHaveLength(1);
    expect(docs[0].sourceProfiles).toEqual(
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
    expect(docs[0].emailDomain).toBe('hiof.no');
  });

  it('prefers manual institution aliases without changing default auto-matching flow', async () => {
    const { service, institutions } = createService();

    const override = await service.upsertInstitutionAliasOverride({
      canonicalName: 'Alanya Alaaddin Keykubat Üniversitesi',
      aliases: ['Alanya Alku Üniversitesi', 'ALKÜ'],
      canonicalLocked: true,
      city: 'Antalya',
      country: 'Türkiye',
    });

    expect(override).toMatchObject({
      canonicalName: 'Alanya Alaaddin Keykubat Üniversitesi',
      manualAliases: ['Alanya Alku Üniversitesi', 'ALKÜ'],
      canonicalLocked: true,
    });

    const result = await service.upsertDiscoveredAuthor({
      displayName: 'Yılmaz Kemal Yüce',
      normalizedName: 'yilmaz kemal yuce',
      affiliationRaw: ['Alanya Alku Üniversitesi'],
      parsedAffiliations: [
        {
          raw: 'Alanya Alku Üniversitesi',
          platform: 'trdizin',
          university: 'Alanya Alku Üniversitesi',
          city: 'Antalya',
          country: 'Türkiye',
        },
      ],
      searchKeywords: ['yilmaz', 'kemal', 'yuce', 'alanya', 'alku'],
      university: 'Alanya Alku Üniversitesi',
      city: 'Antalya',
      country: 'Türkiye',
      sourceProfiles: [
        {
          platform: 'trdizin',
          externalAuthorId: '905079',
          score: 98,
        },
      ],
    });

    expect(institutions).toHaveLength(1);
    expect(institutions[0].canonicalName).toBe(
      'Alanya Alaaddin Keykubat Üniversitesi',
    );
    expect(institutions[0].manualAliases).toEqual(
      expect.arrayContaining(['Alanya Alku Üniversitesi', 'ALKÜ']),
    );
    expect(result.author.university).toBe(
      'Alanya Alaaddin Keykubat Üniversitesi',
    );
    expect(result.author.institution).toMatchObject({
      name: 'Alanya Alaaddin Keykubat Üniversitesi',
      aliases: expect.arrayContaining(['Alanya Alku Üniversitesi']),
    });
  });

  it('creates a fresh institution record when a polluted alias collision points to a different canonical university', async () => {
    const { service, docs, institutions } = createService(
      [
        {
          fullName: 'Adem TEKİN',
          normalizedName: 'adem tekin',
          affiliations: [
            'Adem Tekin. Istanbul Technical University. Verified email at itu.edu.tr - Homepage',
            'İstanbul Teknik Üniversitesi, Bilişim Enstitüsü, İstanbul, Türkiye',
          ],
          parsedAffiliations: [
            {
              raw: 'Adem Tekin. Istanbul Technical University. Verified email at itu.edu.tr - Homepage',
              university: 'Alanya Alaaddin Keykubat Üniversitesi',
              institutionCanonicalName: 'Alanya Alaaddin Keykubat Üniversitesi',
              emailDomain: 'itu.edu.tr',
              platform: 'serpapi_scholar',
            },
            {
              raw: 'İstanbul Teknik Üniversitesi, Bilişim Enstitüsü, İstanbul, Türkiye',
              university: 'Alanya Alaaddin Keykubat Üniversitesi',
              institutionCanonicalName: 'Alanya Alaaddin Keykubat Üniversitesi',
              city: 'İstanbul',
              country: 'Türkiye',
              platform: 'trdizin',
            },
          ],
          sourceProfiles: [
            {
              platform: 'serpapi_scholar',
              externalAuthorId: '6qcuxp4AAAAJ',
            },
          ],
          university: 'Alanya Alaaddin Keykubat Üniversitesi',
          city: 'Antalya',
          country: 'Türkiye',
          emailDomain: 'itu.edu.tr',
          institutionId: 'institution-1',
          institutionCanonicalKey: 'alanya-alaaddin-keykubat-university',
          institutionAliases: [
            'Istanbul Technical University',
            'İstanbul Teknik Üniversitesi',
          ],
        },
      ],
      [
        {
          canonicalName: 'Alanya Alaaddin Keykubat Üniversitesi',
          normalizedKey: 'alanya-alaaddin-keykubat-university',
          aliases: [
            'Istanbul Technical University',
            'İstanbul Teknik Üniversitesi',
          ],
          matchKeys: ['alku', 'itu'],
          city: 'Antalya',
          country: 'Türkiye',
        },
      ],
    );

    const result = await service.upsertDiscoveredAuthor({
      displayName: 'Adem Tekin',
      normalizedName: 'adem tekin',
      affiliationRaw: [
        'İstanbul Teknik Üniversitesi, Bilişim Enstitüsü, İstanbul, Türkiye',
      ],
      parsedAffiliations: [
        {
          raw: 'İstanbul Teknik Üniversitesi, Bilişim Enstitüsü, İstanbul, Türkiye',
          university: 'İstanbul Teknik Üniversitesi',
          city: 'İstanbul',
          country: 'Türkiye',
          platform: 'trdizin',
        },
      ],
      searchKeywords: ['adem', 'tekin', 'istanbul', 'teknik', 'universitesi'],
      university: 'İstanbul Teknik Üniversitesi',
      city: 'İstanbul',
      country: 'Türkiye',
      emailDomain: 'itu.edu.tr',
      sourceProfiles: [
        {
          platform: 'trdizin',
          externalAuthorId: '411567',
          score: 98,
        },
      ],
    });

    expect(institutions).toHaveLength(2);
    expect(
      areInstitutionNamesEquivalent(
        docs[0].university ?? '',
        'Istanbul Technical University',
      ),
    ).toBe(true);
    expect(docs[0].institutionCanonicalKey).toMatch(
      /^istanbul-(technical|teknik)-university$/,
    );
    expect(result.author.city).toBe('İstanbul');
    expect(result.author.profile.city).toBe('İstanbul');
    expect(
      areInstitutionNamesEquivalent(
        result.author.university ?? '',
        'Istanbul Technical University',
      ),
    ).toBe(true);
  });

  it('backfills institutions for existing authors without requiring a new discovery write', async () => {
    const { service, docs, institutions } = createService([
      {
        fullName: 'Yılmaz Kemal Yüce',
        normalizedName: 'yilmaz kemal yuce',
        affiliations: [
          'Department of Computer Engineering, Alanya Alaaddin Keykubat University, Antalya, Türkiye.',
        ],
        parsedAffiliations: [],
        searchKeywords: ['yilmaz', 'kemal', 'yuce'],
      },
    ]);

    const result = await service.backfillInstitutions({ limit: 1000 });

    expect(result).toMatchObject({
      scannedAuthors: 1,
      authorsWithInstitutionData: 1,
      linkedAuthors: 1,
      updatedAuthors: 1,
      institutionsBefore: 0,
      institutionsAfter: 1,
      createdInstitutions: 1,
      dryRun: false,
    });
    expect(institutions).toHaveLength(1);
    expect(institutions[0].canonicalName).toBe(
      'Alanya Alaaddin Keykubat University',
    );
    expect(docs[0].university).toBe('Alanya Alaaddin Keykubat University');
    expect(docs[0].institutionCanonicalKey).toBe(
      'alanya-alaaddin-keykubat-university',
    );
  });

  it('does not write institutions during dry run backfill', async () => {
    const { service, institutions } = createService([
      {
        fullName: 'Yılmaz Kemal Yüce',
        normalizedName: 'yilmaz kemal yuce',
        affiliations: ['Alanya Alaaddin Keykubat University, Antalya, Türkiye'],
        parsedAffiliations: [],
      },
    ]);

    const result = await service.backfillInstitutions({
      limit: 1000,
      dryRun: true,
    });

    expect(result).toMatchObject({
      linkedAuthors: 1,
      institutionsBefore: 0,
      institutionsAfter: 0,
      createdInstitutions: 0,
      dryRun: true,
    });
    expect(institutions).toHaveLength(0);
  });

  it('skips noisy profile snippets and alias-only contamination during backfill', async () => {
    const { service, institutions, docs } = createService([
      {
        fullName: 'Fatma Kübra Uyar',
        normalizedName: 'fatma kubra uyar',
        university:
          'Fatma Kübra Uyar. Bilinmeyen bağlantı. ogrenci.amasya.edu.tr üzerinde doğrulanmış e-posta adresine sahip.',
        institutionAliases: [
          'Afyon Kocatepe Üniversitesi',
          'Alanya Alaaddin Keykubat Üniversitesi',
          'İstanbul Üniversitesi',
        ],
        affiliations: [],
        parsedAffiliations: [],
      },
    ]);

    const result = await service.backfillInstitutions({ limit: 1000 });

    expect(result).toMatchObject({
      linkedAuthors: 0,
      updatedAuthors: 0,
      institutionsAfter: 0,
      createdInstitutions: 0,
    });
    expect(institutions).toHaveLength(0);
    expect(docs[0].institutionCanonicalKey).toBeUndefined();
  });

  it('extracts only the university portion from scholar-style profile strings', async () => {
    const { service, institutions, docs } = createService([
      {
        fullName: 'Murat Alper Başaran',
        normalizedName: 'murat alper basaran',
        university: 'Murat Alper Basaran. Alanya Alaaddin Keykubat University',
        institutionAliases: ['Alanya Alku Üniversitesi'],
        affiliations: [],
        parsedAffiliations: [],
        city: 'Antalya',
        country: 'Türkiye',
      },
    ]);

    const result = await service.backfillInstitutions({ limit: 1000 });

    expect(result).toMatchObject({
      linkedAuthors: 1,
      institutionsAfter: 1,
      createdInstitutions: 1,
    });
    expect(institutions).toHaveLength(1);
    expect(institutions[0].canonicalName).toBe(
      'Alanya Alaaddin Keykubat University',
    );
    expect(institutions[0].aliases).toEqual(
      expect.arrayContaining(['Alanya Alku Üniversitesi']),
    );
    expect(docs[0].institutionCanonicalKey).toBe(
      'alanya-alaaddin-keykubat-university',
    );
  });

  it('drops title and other-names prefixes before university names', async () => {
    const { service, institutions } = createService([
      {
        fullName: 'Fatma Kübra Uyar',
        normalizedName: 'fatma kubra uyar',
        university:
          'Uyar. Other names Dr. Öğr. Üyesi. Alanya Alaaddin Keykubat University',
        affiliations: [],
        parsedAffiliations: [],
        city: 'Antalya',
        country: 'Türkiye',
      },
    ]);

    await service.backfillInstitutions({ limit: 1000 });

    expect(institutions).toHaveLength(1);
    expect(institutions[0].canonicalName).toBe(
      'Alanya Alaaddin Keykubat University',
    );
  });

  it('reset clears stale university fields before a rebuild', async () => {
    const { service, docs, institutions } = createService([
      {
        fullName: 'Ahmet Enis Çetin',
        normalizedName: 'ahmet enis cetin',
        university: 'Uyar. Other names Dr. Öğr. Üyesi. Alanya Alaaddin Keykubat University',
        institutionCanonicalKey:
          'uyar-other-names-dr-ogr-uyesi-alanya-alaaddin-keykubat-university',
        institutionAliases: ['Alanya Alku Üniversitesi'],
        parsedAffiliations: [
          {
            raw: 'Orta Doğu Teknik Üniversitesi, Ankara, Türkiye',
            university:
              'Uyar. Other names Dr. Öğr. Üyesi. Alanya Alaaddin Keykubat University',
            city: 'Ankara',
            country: 'Türkiye',
          },
        ],
      },
    ]);

    const resetResult = await service.resetInstitutions();
    const rebuildResult = await service.backfillInstitutions({ limit: 1000 });

    expect(resetResult).toMatchObject({
      deletedInstitutions: 0,
      resetAuthors: 1,
    });
    expect(rebuildResult).toMatchObject({
      linkedAuthors: 1,
      institutionsAfter: 1,
    });
    expect(docs[0].university).toBe('Orta Doğu Teknik Üniversitesi');
    expect(docs[0].institutionCanonicalKey).toBe('orta-dogu-teknik-university');
    expect(institutions).toHaveLength(1);
    expect(institutions[0].canonicalName).toBe('Orta Doğu Teknik Üniversitesi');
  });

  it('sanitizes malformed institution records before returning filter seeds', async () => {
    const { service } = createService(
      [
        {
          fullName: 'Hospital Example',
          normalizedName: 'hospital example',
          institutionCanonicalKey:
            'department-of-otorhinolaryngology-diskapi-yildirim-beyazit-training-and-research-hospital-university-of-health-sciences-turkey-ankara-turkey',
        },
        {
          fullName: 'Professor Example',
          normalizedName: 'professor example',
          institutionCanonicalKey:
            'professor-university-of-pennsylvania',
        },
      ],
      [
        {
          canonicalName:
            'Department of Otorhinolaryngology, Dışkapı Yıldırım Beyazıt Training and Research Hospital, University of Health Sciences Turkey, Ankara, Turkey',
          normalizedKey:
            'department-of-otorhinolaryngology-diskapi-yildirim-beyazit-training-and-research-hospital-university-of-health-sciences-turkey-ankara-turkey',
          aliases: [],
          city: 'Ankara',
          country: 'Turkey',
        },
        {
          canonicalName: 'Professor, University of Pennsylvania',
          normalizedKey: 'professor-university-of-pennsylvania',
          aliases: [],
          city: 'Pennsylvania',
          country: 'USA',
        },
      ],
    );

    const seeds = await service.listInstitutionFilterSeeds();

    expect(seeds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          canonicalName: 'University of Health Sciences Turkey',
          authorCount: 1,
        }),
        expect.objectContaining({
          canonicalName: 'University of Pennsylvania',
          authorCount: 1,
        }),
      ]),
    );
    expect(
      seeds.find((item) =>
        item.canonicalName.includes('Otorhinolaryngology'),
      ),
    ).toBeUndefined();
    expect(
      seeds.find((item) => item.canonicalName.startsWith('Professor')),
    ).toBeUndefined();
  });
});
