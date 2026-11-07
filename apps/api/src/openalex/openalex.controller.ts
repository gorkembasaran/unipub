import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';
import { OpenalexService } from './openalex.service';

@Controller('openalex')
export class OpenalexController {
  constructor(private readonly openalexService: OpenalexService) {}

  @Get('authors')
  searchAuthors(
    @Query('q') q?: string,
    @Query('institutionId') institutionId?: string,
    @Query('limit') limit?: string,
  ) {
    if (!q?.trim()) {
      throw new BadRequestException(
        '`q` query parametresi gerekli. Ornek: /openalex/authors?q=Aziz%20Sancar',
      );
    }

    return this.openalexService.searchAuthors({
      q: q.trim(),
      institutionId: institutionId?.trim() || undefined,
      limit: this.parseLimit(limit, 10, 50),
    });
  }

  @Get('authors/:id')
  getAuthor(@Param('id') id: string) {
    return this.openalexService.getAuthor(id);
  }

  @Get('authors/:id/works')
  getAuthorWorks(@Param('id') id: string, @Query('limit') limit?: string) {
    return this.openalexService.getAuthorWorks(id, {
      limit: this.parseLimit(limit, 200, 1000),
    });
  }

  private parseLimit(value: string | undefined, fallback: number, max: number) {
    const parsed = value ? Number(value) : fallback;
    return Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), max) : fallback;
  }
}
