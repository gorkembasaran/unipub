import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { TrdizinService } from './trdizin.service';

@Controller('trdizin')
export class TrdizinController {
  constructor(private readonly trdizinService: TrdizinService) {}

  @Get('test-static')
  getStaticAuthorPublications() {
    return this.trdizinService.getStaticAuthorPublications();
  }

  @Get('search')
  searchByAuthor(@Query('q') q?: string) {
    if (!q?.trim()) {
      throw new BadRequestException(
        '`q` query parametresi gerekli. Ornek: /trdizin/search?q=Aziz%20Sancar',
      );
    }

    return this.trdizinService.searchByAuthor(q.trim());
  }

  @Get('search-by-author-id')
  searchByAuthorId(
    @Query('q') q?: string,
    @Query('authorId') authorId?: string,
  ) {
    if (!q?.trim()) {
      throw new BadRequestException(
        '`q` query parametresi gerekli. Ornek: /trdizin/search-by-author-id?q=Yilmaz%20Kemal%20Yuce&authorId=905079',
      );
    }

    if (!authorId?.trim() || Number.isNaN(Number(authorId))) {
      throw new BadRequestException(
        '`authorId` sayisal olmalidir. Ornek: /trdizin/search-by-author-id?q=Yilmaz%20Kemal%20Yuce&authorId=905079',
      );
    }

    return this.trdizinService.searchPublicationsByAuthorId(
      q.trim(),
      Number(authorId),
    );
  }

  @Get('authors-normalized')
  searchAuthorsNormalized(@Query('q') q?: string, @Query('limit') limit?: string) {
    if (!q?.trim()) {
      throw new BadRequestException(
        '`q` query parametresi gerekli. Ornek: /trdizin/authors-normalized?q=Yilmaz%20Kemal%20Yuce',
      );
    }

    const parsedLimit = limit ? Number(limit) : 10;
    const safeLimit = Number.isInteger(parsedLimit)
      ? Math.min(Math.max(parsedLimit, 1), 50)
      : 10;

    return this.trdizinService.searchAuthorsNormalized({
      q: q.trim(),
      limit: safeLimit,
    });
  }

  @Get('authors-static')
  searchAuthorsStatic() {
    return this.trdizinService.searchAuthorsStatic();
  }
}
