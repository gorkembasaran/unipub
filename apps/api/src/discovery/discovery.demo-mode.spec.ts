import { DiscoveryService } from './discovery.service';

// Any call on a provider service fails the test.
const forbiddenProvider = (name: string) =>
  new Proxy(
    {},
    {
      get: (_target, property) => () => {
        throw new Error(`${name}.${String(property)} must not be called in demo mode`);
      },
    },
  );

describe('DiscoveryService in demo mode', () => {
  const originalDemoMode = process.env.DEMO_MODE;

  afterEach(() => {
    if (originalDemoMode === undefined) {
      delete process.env.DEMO_MODE;
    } else {
      process.env.DEMO_MODE = originalDemoMode;
    }
  });

  it('answers author searches from the catalog only', async () => {
    process.env.DEMO_MODE = 'true';
    const catalogService = { searchAuthorsDbOnly: jest.fn().mockResolvedValue([]) };
    const service = new DiscoveryService(
      forbiddenProvider('serpapi') as never,
      forbiddenProvider('trdizin') as never,
      forbiddenProvider('scraper') as never,
      forbiddenProvider('clarivate') as never,
      catalogService as never,
      forbiddenProvider('publicationSync') as never,
    );

    const result = await service.discoverAuthors('Unknown Person', 10);

    expect(catalogService.searchAuthorsDbOnly).toHaveBeenCalled();
    expect(result.source).toBe('db_first');
    expect(result.items).toEqual([]);
  });
});
