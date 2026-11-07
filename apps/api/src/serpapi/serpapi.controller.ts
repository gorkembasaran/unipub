import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { SerpapiService } from './serpapi.service';

@Controller('serpapi/scholar')
export class SerpapiController {
  constructor(private readonly serpapiService: SerpapiService) {}

  @Get('authors')
  searchAuthors(
    @Query('q') q?: string,
    @Query('hl') hl?: string,
    @Query('num') num?: string,
    @Query('start') start?: string,
  ) {
    if (!q?.trim()) {
      throw new BadRequestException(
        '`q` zorunlu. Ornek: /serpapi/scholar/authors?q=Yilmaz%20Yuce',
      );
    }

    return this.serpapiService.searchAuthorsByName({
      q: q.trim(),
      hl: hl?.trim() || undefined,
      num: this.parseOptionalInt(num, 'num'),
      start: this.parseOptionalInt(start, 'start'),
    });
  }

  @Get('authors-normalized')
  searchAuthorsNormalized(
    @Query('q') q?: string,
    @Query('hl') hl?: string,
    @Query('start') start?: string,
    @Query('limit') limit?: string,
  ) {
    if (!q?.trim()) {
      throw new BadRequestException(
        '`q` zorunlu. Ornek: /serpapi/scholar/authors-normalized?q=Yılmaz%20Kemal%20Yüce',
      );
    }

    return this.serpapiService.searchAuthorsNormalized({
      q: q.trim(),
      hl: hl?.trim() || undefined,
      start: this.parseOptionalInt(start, 'start'),
      limit: this.parseOptionalInt(limit, 'limit') ?? 10,
    });
  }

  @Get('authors-static')
  searchStaticYilmazKemalYuce() {
    return this.serpapiService.searchStaticYilmazKemalYuce();
  }

  @Get('account-status')
  accountStatus() {
    return this.serpapiService.getAccountStatus();
  }

  @Get('author-detail')
  authorDetail(
    @Query('authorId') authorId?: string,
    @Query('hl') hl?: string,
    @Query('view_op') viewOp?: string,
    @Query('sort') sort?: string,
    @Query('citation_id') citationId?: string,
  ) {
    if (!authorId?.trim()) {
      throw new BadRequestException(
        '`authorId` zorunlu. Ornek: /serpapi/scholar/author-detail?authorId=K3LR8mUAAAAJ',
      );
    }

    return this.serpapiService.getAuthorDetail({
      authorId: authorId.trim(),
      hl: hl?.trim() || undefined,
      viewOp: viewOp?.trim() || undefined,
      sort: sort?.trim() || undefined,
      citationId: citationId?.trim() || undefined,
    });
  }

  @Get('publications')
  authorPublications(
    @Query('authorId') authorId?: string,
    @Query('hl') hl?: string,
    @Query('sort') sort?: string,
    @Query('limit') limit?: string,
  ) {
    if (!authorId?.trim()) {
      throw new BadRequestException(
        '`authorId` zorunlu. Ornek: /serpapi/scholar/publications?authorId=K3LR8mUAAAAJ',
      );
    }

    const parsedLimit = this.parseOptionalInt(limit, 'limit') ?? 20;
    const safeLimit = Math.min(Math.max(parsedLimit, 1), 100);

    return this.serpapiService.getAuthorPublications({
      authorId: authorId.trim(),
      hl: hl?.trim() || undefined,
      sort: sort === 'title' || sort === 'pubdate' ? sort : undefined,
      limit: safeLimit,
    });
  }

  @Get('publications-static')
  staticAuthorPublications() {
    return this.serpapiService.getStaticAuthorPublications();
  }

  private parseOptionalInt(value: string | undefined, fieldName: string) {
    if (!value?.trim()) {
      return undefined;
    }
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new BadRequestException(
        `\`${fieldName}\` sifir veya pozitif tam sayi olmali.`,
      );
    }
    return parsed;
  }
}
