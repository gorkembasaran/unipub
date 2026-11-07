import { BadRequestException } from '@nestjs/common';
import { CatalogController } from './catalog.controller';

describe('CatalogController publication filter query handling', () => {
  function createController() {
    const catalogService = {
      listPublications: jest.fn(),
    };
    const publicationSyncService = {
      syncAuthorPublications: jest.fn(),
    };

    return {
      controller: new CatalogController(
        catalogService as never,
        publicationSyncService as never,
      ),
      catalogService,
      publicationSyncService,
    };
  }

  it('maps years query into a publishedFrom filter for listPublications', () => {
    const { controller, catalogService } = createController();

    controller.listPublications('author-1', 'query', undefined, undefined, '3');

    expect(catalogService.listPublications).toHaveBeenCalledTimes(1);
    const [input] = catalogService.listPublications.mock.calls[0];

    expect(input.authorId).toBe('author-1');
    expect(input.query).toBe('query');
    expect(input.publishedFrom).toBeInstanceOf(Date);
    expect(input.publishedTo).toBeUndefined();

    const publishedFrom = input.publishedFrom as Date;
    const minimumExpectedYear = new Date().getUTCFullYear() - 3;
    expect(publishedFrom.getUTCFullYear()).toBe(minimumExpectedYear);
  });

  it('forwards year window filters to syncAuthorPublications', () => {
    const { controller, publicationSyncService } = createController();

    controller.syncAuthorPublications(
      'author-1',
      '25',
      'true',
      undefined,
      undefined,
      undefined,
      '5',
    );

    expect(publicationSyncService.syncAuthorPublications).toHaveBeenCalledTimes(1);
    const [authorId, limitPerSource, options] =
      publicationSyncService.syncAuthorPublications.mock.calls[0];

    expect(authorId).toBe('author-1');
    expect(limitPerSource).toBe(25);
    expect(options.force).toBe(true);
    expect(options.publishedFrom).toBeInstanceOf(Date);
    expect(options.publishedTo).toBeUndefined();
  });

  it('caps syncAuthorPublications limitPerSource at 100', () => {
    const { controller, publicationSyncService } = createController();

    controller.syncAuthorPublications(
      'author-1',
      '120',
      'true',
      undefined,
      undefined,
      undefined,
      undefined,
    );

    expect(publicationSyncService.syncAuthorPublications).toHaveBeenCalledTimes(1);
    const [, limitPerSource] =
      publicationSyncService.syncAuthorPublications.mock.calls[0];

    expect(limitPerSource).toBe(100);
  });

  it('rejects invalid year window values', () => {
    const { controller } = createController();

    expect(() =>
      controller.listPublications('author-1', undefined, undefined, undefined, 'abc'),
    ).toThrow(BadRequestException);
  });
});
