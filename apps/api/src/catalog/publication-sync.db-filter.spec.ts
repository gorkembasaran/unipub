import { Types } from 'mongoose';
import { PublicationSyncService } from './publication-sync.service';

describe('PublicationSyncService DB filtering', () => {
  function createService() {
    const authorId = new Types.ObjectId();
    const otherAuthorId = new Types.ObjectId();
    const siblingAuthorId = new Types.ObjectId();
    const now = new Date();
    const cutoffDate = new Date(now);
    cutoffDate.setUTCFullYear(now.getUTCFullYear() - 1);

    const author = {
      _id: authorId,
      fullName: 'Yilmaz Kemal Yuce',
      normalizedName: 'yilmaz kemal yuce',
      sourceProfiles: [
        {
          platform: 'serpapi_scholar',
          externalAuthorId: 'scholar-1',
        },
      ],
      university: 'Alanya Alaaddin Keykubat University',
      city: 'Antalya',
      country: 'Türkiye',
      emailDomain: 'alanya.edu.tr',
    };

    const siblingAuthor = {
      _id: siblingAuthorId,
      fullName: 'YILMAZ KEMAL YUCE - Google Akademik',
      normalizedName: 'yilmaz kemal yuce google akademik',
      sourceProfiles: [
        {
          platform: 'trdizin',
          externalAuthorId: '905079',
        },
      ],
      university: 'Gaziantep Üniversitesi',
      city: 'Gaziantep',
      country: 'Türkiye',
    };

    const publications = [
      {
        _id: new Types.ObjectId(),
        title: 'Recent publication',
        publishedAt: new Date().toISOString(),
        sourceRecords: [],
        authorIds: [authorId],
      },
      {
        _id: new Types.ObjectId(),
        title: 'Old publication',
        publishedAt: '2018-01-15T00:00:00.000Z',
        sourceRecords: [],
        authorIds: [authorId],
      },
      {
        _id: new Types.ObjectId(),
        title: 'Different author publication',
        publishedAt: new Date().toISOString(),
        sourceRecords: [],
        authorIds: [otherAuthorId],
      },
      {
        _id: new Types.ObjectId(),
        title: 'Sibling author publication',
        publishedAt: new Date().toISOString(),
        sourceRecords: [],
        authorIds: [siblingAuthorId],
      },
    ];

    const matchesDateClause = (
      publication: Record<string, unknown>,
      clause: Record<string, unknown>,
    ) => {
      if ('publishedAt' in clause) {
        const condition = clause.publishedAt as { $gte?: Date; $lte?: Date };
        const publishedAt = publication.publishedAt
          ? new Date(String(publication.publishedAt))
          : null;

        if (!publishedAt || Number.isNaN(publishedAt.getTime())) {
          return false;
        }

        if (condition.$gte && publishedAt < condition.$gte) {
          return false;
        }

        if (condition.$lte && publishedAt > condition.$lte) {
          return false;
        }

        return true;
      }

      if ('publishedYear' in clause) {
        const condition = clause.publishedYear as { $gte?: number; $lte?: number };
        const publishedYear =
          typeof publication.publishedYear === 'number'
            ? publication.publishedYear
            : undefined;

        if (publishedYear === undefined) {
          return false;
        }

        if (condition.$gte !== undefined && publishedYear < condition.$gte) {
          return false;
        }

        if (condition.$lte !== undefined && publishedYear > condition.$lte) {
          return false;
        }

        return true;
      }

      return false;
    };

    const publicationModel = {
      find: jest.fn((filter: Record<string, unknown>) => {
        const filtered = publications.filter((publication) => {
          const authorFilter = filter.authorIds as
            | Types.ObjectId
            | { $in?: Types.ObjectId[] }
            | undefined;
          if (authorFilter instanceof Types.ObjectId) {
            if (
              !(publication.authorIds as Types.ObjectId[]).some((item) =>
                item.equals(authorFilter),
              )
            ) {
              return false;
            }
          } else if (authorFilter?.$in?.length) {
            if (
              !(publication.authorIds as Types.ObjectId[]).some((item) =>
                authorFilter.$in?.some((candidate) => item.equals(candidate)),
              )
            ) {
              return false;
            }
          }

          if ('$or' in filter && Array.isArray(filter.$or)) {
            return filter.$or.some((clause) =>
              matchesDateClause(publication as Record<string, unknown>, clause),
            );
          }

          return true;
        });

        return {
          sort() {
            return {
              lean() {
                return {
                  exec: async () => filtered,
                };
              },
            };
          },
        };
      }),
    };

    const authorModel = {
      findById: jest.fn((id: string) => ({
        lean() {
          return {
            exec: async () => (String(authorId) === id ? author : null),
          };
        },
      })),
      find: jest.fn((query: Record<string, unknown>) => ({
        limit() {
          return {
            lean() {
              return {
                exec: async () => {
                  const surnamePattern = Array.isArray(query.$or)
                    ? (query.$or.find(
                        (item) =>
                          item &&
                          typeof item === 'object' &&
                          'fullName' in item &&
                          item.fullName instanceof RegExp,
                      ) as { fullName?: RegExp } | undefined)?.fullName
                    : undefined;

                  return surnamePattern?.test(siblingAuthor.fullName)
                    ? [siblingAuthor]
                    : [];
                },
              };
            },
          };
        },
      })),
    };

    const service = new PublicationSyncService(
      authorModel as never,
      publicationModel as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    return {
      authorId: String(authorId),
      cutoffDate,
      service,
    };
  }

  it('returns only filtered DB publications when a publishedFrom filter is provided', async () => {
    const { authorId, cutoffDate, service } = createService();

    const result = await service.syncAuthorPublications(authorId, 25, {
      publishedFrom: cutoffDate,
    });

    expect(result.dbHit).toBe(true);
    expect(result.mode).toBe('database');
    expect(result.catalogCount).toBe(2);
    expect(result.publications).toHaveLength(2);
    expect(
      result.publications.map((item) => (item as { title?: string }).title),
    ).toEqual(
      expect.arrayContaining([
        'Recent publication',
        'Sibling author publication',
      ]),
    );
  });

  it('includes publications from related duplicate author identities in DB-first mode', async () => {
    const { authorId, service } = createService();

    const result = await service.syncAuthorPublications(authorId, 25);

    expect(result.dbHit).toBe(true);
    expect(
      result.publications.map((item) => (item as { title?: string }).title),
    ).toEqual(
      expect.arrayContaining([
        'Recent publication',
        'Old publication',
        'Sibling author publication',
      ]),
    );
    expect(result.publications).toHaveLength(3);
  });
});
