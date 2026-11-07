import { UnauthorizedException } from '@nestjs/common';
import { DiscoveryController } from './discovery.controller';

describe('DiscoveryController publication sync auth handling', () => {
  function createController() {
    const discoveryService = {
      getAuthorById: jest.fn().mockResolvedValue({
        _id: 'author-1',
        fullName: 'Enis Arslan',
      }),
      syncAuthorPublications: jest.fn(),
    };
    const authService = {
      verifyAccessToken: jest.fn(),
    };

    return {
      controller: new DiscoveryController(
        discoveryService as never,
        authService as never,
      ),
      discoveryService,
      authService,
    };
  }

  it('allows non-force publication sync without an auth token', () => {
    const { controller, discoveryService, authService } = createController();

    controller.syncAuthorPublications(
      'author-1',
      '25',
      'false',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );

    expect(authService.verifyAccessToken).not.toHaveBeenCalled();
    expect(discoveryService.syncAuthorPublications).toHaveBeenCalledTimes(1);
    const [authorId, limitPerSource, options] =
      discoveryService.syncAuthorPublications.mock.calls[0];

    expect(authorId).toBe('author-1');
    expect(limitPerSource).toBe(25);
    expect(options.force).toBe(false);
  });

  it('requires a bearer token for force publication sync', () => {
    const { controller } = createController();

    expect(() =>
      controller.syncAuthorPublications(
        'author-1',
        '25',
        'true',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      ),
    ).toThrow(UnauthorizedException);
  });

  it('verifies the bearer token before allowing force publication sync', () => {
    const { controller, discoveryService, authService } = createController();

    controller.syncAuthorPublications(
      'author-1',
      '25',
      'true',
      undefined,
      undefined,
      undefined,
      undefined,
      'Bearer token-123',
    );

    expect(authService.verifyAccessToken).toHaveBeenCalledWith('token-123');
    expect(discoveryService.syncAuthorPublications).toHaveBeenCalledTimes(1);
    const [, , options] = discoveryService.syncAuthorPublications.mock.calls[0];
    expect(options.force).toBe(true);
  });

  it('creates a refresh request payload for authenticated users', async () => {
    const { controller, discoveryService } = createController();

    await expect(
      controller.requestAuthorRefresh('author-1', {
        context: 'author_detail',
        profilePath: '/author?id=author-1',
      }),
    ).resolves.toMatchObject({
      requested: true,
      status: 'pending',
      authorId: 'author-1',
      authorName: 'Enis Arslan',
      context: 'author_detail',
      profilePath: '/author?id=author-1',
    });

    expect(discoveryService.getAuthorById).toHaveBeenCalledWith('author-1');
  });
});
