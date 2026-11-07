import { SerpapiService } from './serpapi.service';

describe('SerpapiService', () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.SERPAPI_KEY;
  const originalApiKey2 = process.env.SERPAPI_KEY_2;
  const originalActiveKey = process.env.SERPAPI_ACTIVE_KEY;
  const originalCacheTtl = process.env.SERPAPI_CACHE_TTL_MS;

  beforeEach(() => {
    process.env.SERPAPI_KEY = 'test-key';
    process.env.SERPAPI_KEY_2 = 'test-key-2';
    process.env.SERPAPI_ACTIVE_KEY = '1';
    process.env.SERPAPI_CACHE_TTL_MS = '3600000';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.SERPAPI_KEY = originalApiKey;
    process.env.SERPAPI_KEY_2 = originalApiKey2;
    process.env.SERPAPI_ACTIVE_KEY = originalActiveKey;
    process.env.SERPAPI_CACHE_TTL_MS = originalCacheTtl;
    jest.restoreAllMocks();
  });

  it('reuses cached responses for identical author searches', async () => {
    const service = new SerpapiService();
    const payload = {
      organic_results: [
        {
          link: 'https://scholar.google.com/citations?user=abc123',
          title: 'Yılmaz Kemal Yüce - Google Scholar',
          snippet: 'Alanya Alaaddin Keykubat Üniversitesi',
        },
      ],
    };
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => payload,
    } as Response);
    global.fetch = fetchMock as typeof fetch;

    const first = await service.searchAuthorsByName({ q: 'Yılmaz Kemal Yüce' });
    const second = await service.searchAuthorsByName({ q: 'Yılmaz Kemal Yüce' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.total).toBe(1);
    expect(second.total).toBe(1);
  });

  it('surfaces quota exhaustion as a clear provider error', async () => {
    const service = new SerpapiService();
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      text: async () =>
        JSON.stringify({ error: 'Your account has run out of searches.' }),
    } as Response);
    global.fetch = fetchMock as typeof fetch;

    await expect(
      service.searchAuthorsByName({ q: 'Yılmaz Kemal Yüce' }),
    ).rejects.toThrow(
      'SerpAPI kotasi veya saatlik throughput limiti dolu: Your account has run out of searches.',
    );
  });

  it('uses the secondary API key when SERPAPI_ACTIVE_KEY=2', async () => {
    process.env.SERPAPI_ACTIVE_KEY = '2';
    const service = new SerpapiService();
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ organic_results: [] }),
    } as Response);
    global.fetch = fetchMock as typeof fetch;

    await service.searchAuthorsByName({ q: 'Yılmaz Kemal Yüce' });

    const requestedUrl = String(fetchMock.mock.calls[0]?.[0] ?? '');
    expect(requestedUrl).toContain('api_key=test-key-2');
    expect(requestedUrl).not.toContain('api_key=test-key&');
  });

  it('paginates author publications when the first Scholar page is incomplete', async () => {
    const service = new SerpapiService();
    const firstPageArticles = Array.from({ length: 20 }, (_, index) => ({
      title: `Publication ${index + 1}`,
      citation_id: `abc123:pub-${index + 1}`,
      year: 2024,
    }));
    const secondPageArticles = Array.from({ length: 5 }, (_, index) => ({
      title: `Publication ${index + 21}`,
      citation_id: `abc123:pub-${index + 21}`,
      year: 2023,
    }));
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          articles: firstPageArticles,
          serpapi_pagination: {
            next: 'https://serpapi.com/search.json?author_id=abc123&cstart=20&engine=google_scholar_author&hl=en',
          },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          articles: secondPageArticles,
        }),
      } as Response);
    global.fetch = fetchMock as typeof fetch;

    const result = await service.getAuthorPublications({
      authorId: 'abc123',
      hl: 'en',
      sort: 'pubdate',
      limit: 25,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0] ?? '')).toContain('num=25');
    expect(String(fetchMock.mock.calls[1]?.[0] ?? '')).toContain('start=20');
    expect(String(fetchMock.mock.calls[1]?.[0] ?? '')).toContain('num=5');
    expect(result.total).toBe(25);
    expect(result.publications[0]?.title).toBe('Publication 1');
    expect(result.publications[24]?.title).toBe('Publication 25');
  });
});
