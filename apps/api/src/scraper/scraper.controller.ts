import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { ScraperService } from './scraper.service';

@Controller('scraper')
export class ScraperController {
  constructor(private readonly scraperService: ScraperService) {}

  @Get('test-static')
  testStatic() {
    return this.scraperService.fetchStatic();
  }

  @Get('fetch')
  fetchByUrl(@Query('url') url?: string) {
    if (!url?.trim()) {
      throw new BadRequestException(
        '`url` query parametresi gerekli. Ornek: /scraper/fetch?url=https%3A%2F%2Fexample.com',
      );
    }

    return this.scraperService.fetchByUrl(url.trim());
  }

  @Get('parse-static')
  parseStaticAuthors() {
    return this.scraperService.parseStaticAuthors();
  }

  @Get('parse')
  parseAuthorsByUrl(@Query('url') url?: string) {
    if (!url?.trim()) {
      throw new BadRequestException(
        '`url` query parametresi gerekli. Ornek: /scraper/parse?url=https%3A%2F%2Fwww.scopus.com%2Fresults%2FauthorNamesList.uri',
      );
    }

    return this.scraperService.parseAuthorsFromUrl(url.trim());
  }

  @Get('author-detail-static')
  scrapeStaticAuthorDetail(@Query('index') index?: string) {
    const parsedIndex = this.parseIndex(index);
    return this.scraperService.scrapeStaticAuthorDetail(parsedIndex);
  }

  @Get('author-detail')
  scrapeAuthorDetailByListUrl(
    @Query('url') url?: string,
    @Query('index') index?: string,
  ) {
    if (!url?.trim()) {
      throw new BadRequestException(
        '`url` query parametresi gerekli. Ornek: /scraper/author-detail?url=https%3A%2F%2Fwww.scopus.com%2Fresults%2FauthorNamesList.uri&index=0',
      );
    }

    const parsedIndex = this.parseIndex(index);
    return this.scraperService.scrapeAuthorDetailFromListUrl(
      url.trim(),
      parsedIndex,
    );
  }

  @Get('author-profile-detail')
  scrapeAuthorProfileDetail(@Query('authorProfileUrl') authorProfileUrl?: string) {
    if (!authorProfileUrl?.trim()) {
      throw new BadRequestException(
        '`authorProfileUrl` query parametresi gerekli. Ornek: /scraper/author-profile-detail?authorProfileUrl=https%3A%2F%2Fwww.scopus.com%2Fauthid%2Fdetail.uri%3FauthorId%3D18635626400',
      );
    }

    return this.scraperService.scrapeAuthorProfileUrl(authorProfileUrl.trim());
  }

  @Get('pubmed-parse')
  parsePubmed(@Query('url') url?: string) {
    if (!url?.trim()) {
      throw new BadRequestException(
        '`url` query parametresi gerekli. Ornek: /scraper/pubmed-parse?url=https%3A%2F%2Fpubmed.ncbi.nlm.nih.gov%2F%3Fterm%3DYuce%2BYK%26cauthor_id%3D25160244',
      );
    }

    return this.scraperService.parsePubmedSearchResults(url.trim());
  }

  @Get('pubmed/authors-static')
  searchPubmedAuthorStatic(@Query('limit') limit?: string) {
    const parsedLimit = this.parseLimit(limit, 20);
    return this.scraperService.searchPubmedAuthorStatic(parsedLimit);
  }

  @Get('pubmed/authors')
  searchPubmedAuthor(@Query('q') q?: string, @Query('limit') limit?: string) {
    if (!q?.trim()) {
      throw new BadRequestException(
        '`q` query parametresi gerekli. Ornek: /scraper/pubmed/authors?q=Y%C4%B1lmaz%20Kemal%20Y%C3%BCce',
      );
    }

    const parsedLimit = this.parseLimit(limit, 20);
    return this.scraperService.searchPubmedAuthor(q.trim(), parsedLimit);
  }

  @Get('scopus/authors-static')
  searchScopusAuthorsStatic(@Query('limit') limit?: string) {
    const parsedLimit = this.parseLimit(limit, 10);
    return this.scraperService.searchScopusAuthorsStatic(parsedLimit);
  }

  @Get('scopus/authors')
  searchScopusAuthors(@Query('q') q?: string, @Query('limit') limit?: string) {
    if (!q?.trim()) {
      throw new BadRequestException(
        '`q` query parametresi gerekli. Ornek: /scraper/scopus/authors?q=Y%C4%B1lmaz%20Kemal%20Y%C3%BCce',
      );
    }

    const parsedLimit = this.parseLimit(limit, 10);
    return this.scraperService.searchScopusAuthors(q.trim(), parsedLimit);
  }

  @Get('scopus/author-detail')
  scrapeScopusAuthorDetail(@Query('authorId') authorId?: string) {
    if (!authorId?.trim()) {
      throw new BadRequestException(
        '`authorId` query parametresi gerekli. Ornek: /scraper/scopus/author-detail?authorId=18635626400',
      );
    }

    return this.scraperService.scrapeScopusAuthorDetailById(authorId.trim());
  }

  private parseIndex(index?: string) {
    if (!index) {
      return 0;
    }

    const parsed = Number(index);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new BadRequestException(
        '`index` sifir veya pozitif tam sayi olmali.',
      );
    }

    return parsed;
  }

  private parseLimit(limit?: string, fallback = 10) {
    if (!limit) {
      return fallback;
    }

    const parsed = Number(limit);
    if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 50) {
      throw new BadRequestException(
        '`limit` 1 ile 50 arasinda tam sayi olmali.',
      );
    }

    return parsed;
  }
}
