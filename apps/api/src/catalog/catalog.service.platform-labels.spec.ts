import { CatalogService } from './catalog.service';

describe('CatalogService platform labels', () => {
  function createService() {
    return new CatalogService({} as never, {} as never, {} as never);
  }

  it('formats Clarivate author source profiles with a Web Of Science label', () => {
    const service = createService();

    const formatted = (service as any).formatAuthorOutput({
      fullName: 'Yilmaz Kemal Yuce',
      sourceProfiles: [
        {
          platform: 'clarivate_wos',
          externalAuthorId: 'AAB-1234-2020',
        },
      ],
    });

    expect(formatted.sourceProfiles[0]).toMatchObject({
      platform: 'Web Of Science',
      platformKey: 'clarivate_wos',
      platformLabel: 'Web Of Science',
    });
    expect(formatted.platformIds).toEqual({
      'Web Of Science': ['AAB-1234-2020'],
    });
    expect(formatted.platformIdsRaw).toEqual({
      clarivate_wos: ['AAB-1234-2020'],
    });
  });

  it('formats Clarivate publication source records with a Web Of Science label', () => {
    const service = createService();

    const formatted = (service as any).formatPublicationOutput({
      title: 'A Clarivate-backed publication',
      sourceRecords: [
        {
          platform: 'clarivate_wos',
          sourceId: 'WOS:0001',
        },
      ],
    });

    expect(formatted.sourceRecords[0]).toMatchObject({
      platform: 'Web Of Science',
      platformKey: 'clarivate_wos',
      platformLabel: 'Web Of Science',
    });
  });
});
