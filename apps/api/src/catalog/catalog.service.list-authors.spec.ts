import { Types } from 'mongoose';
import { CatalogService } from './catalog.service';

describe('CatalogService.listAuthors', () => {
  it('returns authors with publication counts, most published first', async () => {
    const ayse = new Types.ObjectId();
    const mehmet = new Types.ObjectId();
    const zeynep = new Types.ObjectId();
    const exec = (value: unknown) => ({ exec: async () => value });

    const authorModel = {
      find: jest.fn(() => ({
        sort: () => ({
          limit: () => ({
            lean: () =>
              exec([
                { _id: ayse, fullName: 'Ayşe Kaya', university: 'Example University', city: 'Antalya' },
                { _id: mehmet, fullName: 'Mehmet Demir' },
                { _id: zeynep, fullName: 'Zeynep Ak' },
              ]),
          }),
        }),
      })),
    };
    const publicationModel = {
      aggregate: jest.fn(() =>
        exec([
          { _id: ayse, count: 2 },
          { _id: zeynep, count: 5 },
        ]),
      ),
    };

    const service = new CatalogService(
      authorModel as never,
      {} as never,
      publicationModel as never,
    );

    const result = await service.listAuthors(10);

    expect(result.map((author) => [author.fullName, author.publicationCount])).toEqual([
      ['Zeynep Ak', 5],
      ['Ayşe Kaya', 2],
      ['Mehmet Demir', 0],
    ]);
    expect(result[1]).toMatchObject({
      _id: ayse.toString(),
      university: 'Example University',
      city: 'Antalya',
      country: null,
    });
  });
});
