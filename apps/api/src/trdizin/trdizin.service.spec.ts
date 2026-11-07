import { TrdizinService } from './trdizin.service';

describe('TrdizinService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('fetches additional pages when author matches are beyond the first page', async () => {
    const service = new TrdizinService();
    const firstPage = {
      hits: {
        total: { value: 25 },
        hits: Array.from({ length: 20 }, (_, index) => ({
          _source: {
            id: `${index + 1}`,
            orderTitle: `Other publication ${index + 1}`,
            authors: [{ authorId: 1000 + index, inPublicationName: 'Other' }],
          },
        })),
      },
    };
    const secondPage = {
      hits: {
        total: { value: 25 },
        hits: [
          ...Array.from({ length: 4 }, (_, index) => ({
            _source: {
              id: `${index + 21}`,
              orderTitle: `Other publication ${index + 21}`,
              authors: [{ authorId: 2000 + index, inPublicationName: 'Other' }],
            },
          })),
          {
            _source: {
              id: '25',
              orderTitle: 'Target publication',
              authors: [
                {
                  authorId: 905079,
                  inPublicationName: 'Yılmaz Kemal YÜCE',
                },
              ],
            },
          },
        ],
      },
    };

    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => firstPage,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => secondPage,
      } as Response);
    global.fetch = fetchMock as typeof fetch;

    const result = await service.searchPublicationsByAuthorId(
      'Yılmaz Kemal Yüce',
      905079,
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain('page=1');
    expect(String(fetchMock.mock.calls[1][0])).toContain('page=2');
    expect(result.totalFetched).toBe(25);
    expect(result.matchedCount).toBe(1);
    expect(result.matchedPublications[0]?.publication?.orderTitle).toBe(
      'Target publication',
    );
    expect(result.pagesFetched).toBe(2);
  });

  it('ignores TR Dizin publications when the matched author id belongs to a different name variant', async () => {
    const service = new TrdizinService();
    const payload = {
      hits: {
        total: { value: 1 },
        hits: [
          {
            _source: {
              id: '1',
              orderTitle: 'Wrongly linked publication',
              authors: [
                {
                  authorId: 905079,
                  inPublicationName: 'T. Arslan',
                },
              ],
            },
          },
        ],
      },
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => payload,
    } as Response) as typeof fetch;

    const result = await service.searchPublicationsByAuthorId(
      'Yılmaz Kemal Yüce',
      905079,
    );

    expect(result.matchedCount).toBe(0);
    expect(result.matchedPublications).toEqual([]);
  });

  it('searchAuthorsNormalized scans later pages for author candidates', async () => {
    const service = new TrdizinService();
    const firstPage = {
      hits: {
        total: { value: 22 },
        hits: Array.from({ length: 20 }, (_, index) => ({
          _source: {
            id: `${index + 1}`,
            orderTitle: `Other publication ${index + 1}`,
            authors: [
              {
                authorId: `${1000 + index}`,
                inPublicationName: `Other Author ${index + 1}`,
              },
            ],
          },
        })),
      },
    };
    const secondPage = {
      hits: {
        total: { value: 22 },
        hits: [
          {
            _source: {
              id: '21',
              orderTitle: 'Target publication',
              authors: [
                {
                  authorId: '905079',
                  inPublicationName: 'Yılmaz Kemal YÜCE',
                  institutionName: ['Alanya Alaaddin Keykubat University'],
                },
              ],
            },
          },
          {
            _source: {
              id: '22',
              orderTitle: 'Another publication',
              authors: [
                {
                  authorId: '1200',
                  inPublicationName: 'Another Author',
                },
              ],
            },
          },
        ],
      },
    };

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => firstPage,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => secondPage,
      } as Response) as typeof fetch;

    const result = await service.searchAuthorsNormalized({
      q: 'Yılmaz Kemal Yüce',
      limit: 5,
    });

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(result.pagesFetched).toBe(2);
    expect(result.totalRaw).toBe(22);
    expect(result.authors[0]).toMatchObject({
      authorId: '905079',
      displayName: 'Yılmaz Kemal YÜCE',
    });
  });
});
