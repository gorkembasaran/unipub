import { Injectable } from '@nestjs/common';
import {
  AdminAuthorUpdateInput,
  AdminDetachSourceProfilesInput,
  AdminMergeAuthorsInput,
  AdminRemoveSourceProfilesInput,
  AdminReassignPublicationsInput,
  CatalogService,
} from '../catalog/catalog.service';

@Injectable()
export class AdminService {
  constructor(private readonly catalogService: CatalogService) {}

  async searchAuthors(query: string, limit = 20) {
    const items = await this.catalogService.adminSearchAuthors(query, limit);
    return {
      query,
      total: items.length,
      items,
    };
  }

  getAuthor(id: string) {
    return this.catalogService.getAuthorById(id);
  }

  listAuthorPublications(input: {
    authorId: string;
    query?: string;
    publishedFrom?: Date;
    publishedTo?: Date;
  }) {
    return this.catalogService.listPublications({
      authorId: input.authorId,
      query: input.query,
      publishedFrom: input.publishedFrom,
      publishedTo: input.publishedTo,
    });
  }

  updateAuthor(id: string, input: AdminAuthorUpdateInput) {
    return this.catalogService.adminUpdateAuthor(id, input);
  }

  mergeAuthors(input: AdminMergeAuthorsInput) {
    return this.catalogService.adminMergeAuthors(input);
  }

  detachSourceProfiles(authorId: string, input: AdminDetachSourceProfilesInput) {
    return this.catalogService.adminDetachSourceProfiles(authorId, input);
  }

  removeSourceProfiles(authorId: string, input: AdminRemoveSourceProfilesInput) {
    return this.catalogService.adminRemoveSourceProfiles(authorId, input);
  }

  reassignPublications(input: AdminReassignPublicationsInput) {
    return this.catalogService.adminReassignPublications(input);
  }
}
