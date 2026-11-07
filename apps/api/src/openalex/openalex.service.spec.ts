import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OpenalexService } from './openalex.service';

const jsonResponse = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => body,
  }) as Response;

describe('OpenalexService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('normalizes author search results and applies the institution filter', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      jsonResponse({
        meta: { count: 1 },
        results: [
          {
            id: 'https://openalex.org/A5000000001',
            orcid: 'https://orcid.org/0000-0002-1825-0097',
            display_name: 'Ayse Yilmaz',
            works_count: 42,
            cited_by_count: 310,
            summary_stats: { h_index: 9 },
            last_known_institutions: [
              {
                id: 'https://openalex.org/I4210000001',
                display_name: 'Example University',
                country_code: 'TR',
              },
            ],
          },
        ],
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await new OpenalexService().searchAuthors({
      q: 'Ayse Yilmaz',
      institutionId: 'https://openalex.org/i4210000001',
      limit: 5,
    });

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.pathname).toBe('/authors');
    expect(url.searchParams.get('search')).toBe('Ayse Yilmaz');
    expect(url.searchParams.get('filter')).toBe(
      'last_known_institutions.id:I4210000001',
    );
    expect(url.searchParams.get('per-page')).toBe('5');
    expect(result.total).toBe(1);
    expect(result.authors[0]).toEqual({
      externalId: 'A5000000001',
      displayName: 'Ayse Yilmaz',
      orcid: '0000-0002-1825-0097',
      worksCount: 42,
      citedByCount: 310,
      hIndex: 9,
      institutions: [
        { id: 'I4210000001', name: 'Example University', countryCode: 'TR' },
      ],
      profileUrl: 'https://openalex.org/A5000000001',
    });
  });

  it('follows cursors until the work limit is reached', async () => {
    const work = (n: number) => ({
      id: `https://openalex.org/W${n}`,
      doi: `https://doi.org/10.1000/${n}`,
      display_name: `Work ${n}`,
      publication_year: 2024,
      type: 'article',
      cited_by_count: n,
      open_access: { is_oa: n % 2 === 0 },
      primary_location: { source: { display_name: 'Journal X' } },
      authorships: [{ author: { display_name: 'Ayse Yilmaz' } }],
    });
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ meta: { count: 3, next_cursor: 'c2' }, results: [work(1), work(2)] }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ meta: { count: 3, next_cursor: null }, results: [work(3)] }),
      );
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await new OpenalexService().getAuthorWorks('A5000000001', {
      limit: 10,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondUrl = new URL(fetchMock.mock.calls[1][0] as string);
    expect(secondUrl.searchParams.get('cursor')).toBe('c2');
    expect(secondUrl.searchParams.get('filter')).toBe('author.id:A5000000001');
    expect(result.works).toHaveLength(3);
    expect(result.works[0]).toMatchObject({
      externalId: 'W1',
      doi: '10.1000/1',
      journal: 'Journal X',
      authors: ['Ayse Yilmaz'],
      isOpenAccess: false,
    });
  });

  it('rejects malformed author ids without calling the API', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(new OpenalexService().getAuthor('not-an-id')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps a 404 to NotFoundException', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({}, 404)) as unknown as typeof fetch;

    await expect(new OpenalexService().getAuthor('A1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
