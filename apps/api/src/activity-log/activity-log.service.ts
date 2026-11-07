import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Response } from 'express';
import { Model } from 'mongoose';
import { normalizePersonName } from '../common/normalize-person-name';
import { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { AuthSessionUser } from '../auth/auth.types';
import {
  ApiActivityLog,
  ApiActivityLogDocument,
} from './schemas/api-activity-log.schema';

type CaptureHttpActivityInput = {
  requestId: string;
  request: AuthenticatedRequest;
  response: Response;
  controllerName?: string;
  handlerName?: string;
  durationMs: number;
  result?: unknown;
  error?: unknown;
};

type ActivityLogListParams = {
  page?: number;
  pageSize?: number;
  category?: string;
  action?: string;
  status?: string;
  success?: boolean;
  actorType?: string;
  entityType?: string;
  q?: string;
  from?: Date;
  to?: Date;
};

type ActivityLogUpdateInput = {
  action?: string;
  category?: string;
  actor?: Record<string, unknown>;
  entity?: Record<string, unknown>;
  request?: Record<string, unknown>;
  response?: Record<string, unknown>;
  error?: Record<string, unknown> | null;
  summary?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  admin?: {
    status?: string;
    tags?: string[];
    note?: string;
    pinned?: boolean;
  };
};

const SENSITIVE_KEY_PATTERN =
  /(password|token|authorization|cookie|secret|refreshToken|accessToken)/i;
const MAX_STRING_LENGTH = 500;
const MAX_OBJECT_KEYS = 40;
const MAX_ARRAY_ITEMS = 25;
const MAX_DEPTH = 5;

@Injectable()
export class ActivityLogService {
  private readonly logger = new Logger(ActivityLogService.name);

  constructor(
    @InjectModel(ApiActivityLog.name)
    private readonly activityLogModel: Model<ApiActivityLogDocument>,
  ) {}

  async captureHttpActivity(input: CaptureHttpActivityInput) {
    if (this.shouldSkipRequest(input.request)) {
      return;
    }

    try {
      const request = input.request;
      const method = request.method.toUpperCase();
      const path = request.path || request.url || '/';
      const route = this.resolveRoutePattern(request);
      const action = this.resolveAction({
        method,
        path,
        route,
        controllerName: input.controllerName,
        handlerName: input.handlerName,
        query: request.query,
      });
      const category = this.resolveCategory(action, path);
      const statusCode = this.resolveStatusCode(input.response, input.error);
      const success = statusCode < 400;

      const summary = this.buildSummary({
        action,
        request,
        result: input.result,
        error: input.error,
      });
      const actor = this.resolveActor(request, input.result);
      const entity = this.resolveEntity(action, request, input.result);

      await this.activityLogModel.create({
        requestId: input.requestId,
        action,
        category,
        actor,
        entity,
        request: {
          method,
          path,
          originalUrl: request.originalUrl || path,
          route,
          controllerName: input.controllerName,
          handlerName: input.handlerName,
          params: this.sanitizeValue(request.params ?? {}),
          query: this.sanitizeValue(request.query ?? {}),
          body: this.sanitizeValue(request.body ?? {}),
          headers: this.sanitizeHeaders(request.headers ?? {}),
          ip: this.resolveIp(request),
          userAgent:
            typeof request.headers['user-agent'] === 'string'
              ? request.headers['user-agent']
              : undefined,
        },
        response: {
          statusCode,
          durationMs: Math.max(0, Math.round(input.durationMs)),
          success,
        },
        error: input.error
          ? {
              name: this.readString(input.error, ['name']),
              message: this.readString(input.error, ['message']),
              statusCode,
            }
          : undefined,
        summary,
        metadata: {
          queryTokenCount: this.extractSearchTokens(request.query?.q).length,
          responseType: this.detectResultType(input.result),
        },
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'activity log capture failed';
      this.logger.error(message);
    }
  }

  async listLogs(params: ActivityLogListParams = {}) {
    const page = Number.isInteger(params.page) ? Math.max(params.page ?? 1, 1) : 1;
    const pageSize = Number.isInteger(params.pageSize)
      ? Math.min(Math.max(params.pageSize ?? 20, 1), 100)
      : 20;
    const match = this.buildListMatch(params);

    const [total, docs, categoryFacets, actionFacets, statusFacets] =
      await Promise.all([
        this.activityLogModel.countDocuments(match).exec(),
        this.activityLogModel
          .find(match)
          .sort({ 'admin.pinned': -1, createdAt: -1 })
          .skip((page - 1) * pageSize)
          .limit(pageSize)
          .exec(),
        this.aggregateFacet(match, 'category'),
        this.aggregateFacet(match, 'action'),
        this.aggregateFacet(match, 'admin.status'),
      ]);

    return {
      page,
      pageSize,
      total,
      totalPages: total > 0 ? Math.ceil(total / pageSize) : 0,
      filters: {
        category: params.category ?? null,
        action: params.action ?? null,
        status: params.status ?? null,
        success: typeof params.success === 'boolean' ? params.success : null,
        actorType: params.actorType ?? null,
        entityType: params.entityType ?? null,
        q: params.q?.trim() || null,
        from: params.from?.toISOString() ?? null,
        to: params.to?.toISOString() ?? null,
      },
      facets: {
        categories: categoryFacets,
        actions: actionFacets,
        statuses: statusFacets,
      },
      items: docs.map((doc) => this.formatLogListItem(doc)),
      fetchedAt: new Date().toISOString(),
    };
  }

  async getLogById(id: string) {
    const doc = await this.activityLogModel.findById(id).exec();
    if (!doc) {
      throw new NotFoundException('Log kaydi bulunamadi.');
    }

    return this.formatLogDetail(doc);
  }

  async updateLog(
    id: string,
    input: ActivityLogUpdateInput,
    editor?: AuthSessionUser,
  ) {
    const doc = await this.activityLogModel.findById(id).exec();
    if (!doc) {
      throw new NotFoundException('Log kaydi bulunamadi.');
    }

    if (typeof input.action === 'string' && input.action.trim()) {
      doc.action = input.action.trim();
    }
    if (typeof input.category === 'string' && input.category.trim()) {
      doc.category = input.category.trim();
    }
    if (input.actor && typeof input.actor === 'object') {
      doc.actor = this.sanitizeValue(input.actor) as any;
    }
    if (input.entity && typeof input.entity === 'object') {
      doc.entity = this.sanitizeValue(input.entity) as any;
    }
    if (input.request && typeof input.request === 'object') {
      doc.request = this.sanitizeValue(input.request) as any;
    }
    if (input.response && typeof input.response === 'object') {
      doc.response = this.sanitizeValue(input.response) as any;
    }
    if (input.summary && typeof input.summary === 'object') {
      doc.summary = this.sanitizeValue(input.summary) as any;
    }
    if (input.metadata && typeof input.metadata === 'object') {
      doc.metadata = this.sanitizeValue(input.metadata) as any;
    }
    if (input.error === null) {
      doc.error = undefined;
    } else if (input.error && typeof input.error === 'object') {
      doc.error = this.sanitizeValue(input.error) as any;
    }

    const nextAdmin = this.toPlainRecord(doc.admin);
    const adminInput = input.admin ?? {};
    if (typeof adminInput.status === 'string' && adminInput.status.trim()) {
      nextAdmin.status = adminInput.status.trim();
    }
    if (Array.isArray(adminInput.tags)) {
      nextAdmin.tags = [
        ...new Set(
          adminInput.tags
            .map((item) => item.trim())
            .filter(Boolean),
        ),
      ];
    }
    if (typeof adminInput.note === 'string') {
      const trimmedNote = adminInput.note.trim();
      nextAdmin.note = trimmedNote || undefined;
    }
    if (typeof adminInput.pinned === 'boolean') {
      nextAdmin.pinned = adminInput.pinned;
    }
    nextAdmin.updatedAt = new Date();
    nextAdmin.updatedBy = editor
      ? {
          id: editor._id,
          email: editor.email,
          fullName: editor.fullName,
        }
      : undefined;
    doc.admin = nextAdmin as any;

    const saved = await doc.save();
    return this.formatLogDetail(saved);
  }

  async deleteLog(id: string) {
    const doc = await this.activityLogModel.findByIdAndDelete(id).exec();
    if (!doc) {
      throw new NotFoundException('Log kaydi bulunamadi.');
    }

    return {
      deleted: true,
      id,
      deletedAt: new Date().toISOString(),
    };
  }

  private shouldSkipRequest(request: AuthenticatedRequest) {
    const path = request.path || request.url || '';
    return (
      request.method.toUpperCase() === 'OPTIONS' ||
      path.startsWith('/activity-logs') ||
      path.startsWith('/admin/activity-logs')
    );
  }

  private buildListMatch(params: ActivityLogListParams) {
    const match: Record<string, unknown> = {};

    if (params.category?.trim()) {
      match.category = params.category.trim();
    }
    if (params.action?.trim()) {
      match.action = params.action.trim();
    }
    if (params.status?.trim()) {
      match['admin.status'] = params.status.trim();
    }
    if (typeof params.success === 'boolean') {
      match['response.success'] = params.success;
    }
    if (params.actorType?.trim()) {
      match['actor.type'] = params.actorType.trim();
    }
    if (params.entityType?.trim()) {
      match['entity.type'] = params.entityType.trim();
    }
    if (params.from || params.to) {
      const createdAt: Record<string, Date> = {};
      if (params.from) {
        createdAt.$gte = params.from;
      }
      if (params.to) {
        createdAt.$lte = params.to;
      }
      match.createdAt = createdAt;
    }

    const q = params.q?.trim();
    if (q) {
      const regex = new RegExp(this.escapeRegex(q), 'i');
      match.$or = [
        { requestId: regex },
        { action: regex },
        { category: regex },
        { 'request.path': regex },
        { 'request.originalUrl': regex },
        { 'actor.email': regex },
        { 'actor.fullName': regex },
        { 'entity.id': regex },
        { 'entity.name': regex },
        { 'summary.query': regex },
        { 'summary.searchedQuery': regex },
        { 'summary.message': regex },
      ];
    }

    return match;
  }

  private async aggregateFacet(
    match: Record<string, unknown>,
    field: string,
  ) {
    const rows = await this.activityLogModel
      .aggregate([
        { $match: match as Record<string, unknown> },
        { $group: { _id: `$${field}`, count: { $sum: 1 } } },
        { $match: { _id: { $nin: [null, ''] } } },
        { $sort: { count: -1, _id: 1 } },
        { $limit: 100 },
      ])
      .exec();

    return rows.map((row) => ({
      value: String(row._id),
      label: String(row._id),
      count: Number(row.count ?? 0),
    }));
  }

  private formatLogListItem(doc: ApiActivityLogDocument) {
    const plain = this.toPlainRecord(doc);
    const summary = this.readRecord(plain, ['summary']);
    const actor = this.readRecord(plain, ['actor']);
    const entity = this.readRecord(plain, ['entity']);
    const request = this.readRecord(plain, ['request']);
    const response = this.readRecord(plain, ['response']);
    const admin = this.readRecord(plain, ['admin']);

    return {
      id: this.readString(plain, ['_id', 'id']),
      requestId: this.readString(plain, ['requestId']) ?? '',
      action: this.readString(plain, ['action']) ?? '',
      category: this.readString(plain, ['category']) ?? '',
      createdAt:
        this.readString(plain, ['createdAt']) ??
        ((plain.createdAt as Date | undefined)?.toISOString?.() ?? ''),
      updatedAt:
        this.readString(plain, ['updatedAt']) ??
        ((plain.updatedAt as Date | undefined)?.toISOString?.() ?? ''),
      actor: this.sanitizeValue(actor),
      entity: this.sanitizeValue(entity),
      response: {
        statusCode: this.readNumber(response, ['statusCode']) ?? 0,
        durationMs: this.readNumber(response, ['durationMs']) ?? 0,
        success: this.readBoolean(response, ['success']) ?? false,
      },
      admin: {
        status: this.readString(admin, ['status']) ?? 'open',
        tags: Array.isArray(admin.tags)
          ? admin.tags
              .map((item) =>
                typeof item === 'string' ? item.trim() : String(item ?? '').trim(),
              )
              .filter(Boolean)
          : [],
        note:
          this.readString(admin, ['note']) ??
          undefined,
        pinned: this.readBoolean(admin, ['pinned']) ?? false,
        updatedAt:
          this.readString(admin, ['updatedAt']) ??
          ((admin.updatedAt as Date | undefined)?.toISOString?.() ?? undefined),
        updatedBy: this.sanitizeValue(this.readRecord(admin, ['updatedBy'])),
      },
      preview: {
        title:
          this.readString(entity, ['name']) ||
          this.readString(summary, ['searchedQuery', 'query']) ||
          this.readString(request, ['path']) ||
          'Log kaydi',
        subtitle:
          this.readString(actor, ['fullName', 'email']) ||
          this.readString(entity, ['id']) ||
          this.readString(summary, ['message']) ||
          undefined,
        query:
          this.readString(summary, ['searchedQuery', 'query']) ?? undefined,
        resultCount:
          this.readNumber(summary, ['resultCount', 'publicationCount']) ??
          undefined,
        path: this.readString(request, ['path', 'originalUrl']) ?? undefined,
        method: this.readString(request, ['method']) ?? undefined,
      },
    };
  }

  private formatLogDetail(doc: ApiActivityLogDocument) {
    const plain = this.toPlainRecord(doc);
    return {
      ...this.sanitizeValue(plain),
      id: this.readString(plain, ['_id', 'id']),
      createdAt:
        this.readString(plain, ['createdAt']) ??
        ((plain.createdAt as Date | undefined)?.toISOString?.() ?? ''),
      updatedAt:
        this.readString(plain, ['updatedAt']) ??
        ((plain.updatedAt as Date | undefined)?.toISOString?.() ?? ''),
    };
  }

  private resolveStatusCode(response: Response, error?: unknown) {
    const errorStatus =
      typeof (error as { status?: unknown })?.status === 'number'
        ? Number((error as { status?: unknown }).status)
        : typeof (error as { statusCode?: unknown })?.statusCode === 'number'
          ? Number((error as { statusCode?: unknown }).statusCode)
          : typeof (error as { getStatus?: () => number })?.getStatus ===
                'function'
            ? Number((error as { getStatus: () => number }).getStatus())
            : undefined;

    return errorStatus ?? response.statusCode ?? 500;
  }

  private resolveRoutePattern(request: AuthenticatedRequest) {
    const baseUrl = request.baseUrl?.trim() ?? '';
    const routePath =
      typeof request.route?.path === 'string' ? request.route.path.trim() : '';
    if (baseUrl || routePath) {
      return `${baseUrl}${routePath}` || request.path || request.url || '/';
    }
    return request.path || request.url || '/';
  }

  private resolveAction(input: {
    method: string;
    path: string;
    route?: string;
    controllerName?: string;
    handlerName?: string;
    query?: Record<string, unknown>;
  }) {
    const normalizedPath = (input.route || input.path || '').toLowerCase();
    const handlerName = input.handlerName ?? '';
    const controllerName = input.controllerName ?? '';

    if (normalizedPath.includes('/auth/login') || handlerName === 'login') {
      return 'auth_login';
    }

    if (handlerName === 'discoverAuthors') {
      return 'author_search';
    }

    if (handlerName === 'getAuthor') {
      return 'author_detail_view';
    }

    if (handlerName === 'syncAuthorPublications') {
      return 'author_publications_sync';
    }

    if (
      handlerName === 'requestAuthorRefresh' ||
      normalizedPath.includes('/refresh-request')
    ) {
      return 'author_refresh_request';
    }

    if (handlerName === 'listPublications') {
      if (
        normalizedPath.includes('export') ||
        normalizedPath.includes('pdf') ||
        String(input.query?.format ?? '').toLowerCase() === 'pdf'
      ) {
        return 'author_publications_export_pdf';
      }
      return 'author_publications_list';
    }

    if (handlerName === 'getPublication') {
      return 'publication_detail_view';
    }

    if (
      normalizedPath.includes('export') ||
      normalizedPath.includes('pdf') ||
      String(input.query?.format ?? '').toLowerCase() === 'pdf'
    ) {
      return 'export_pdf';
    }

    const controllerToken = controllerName
      .replace(/Controller$/, '')
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .toLowerCase();
    const handlerToken = handlerName
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .toLowerCase();

    return [controllerToken || 'api', handlerToken || input.method.toLowerCase()]
      .filter(Boolean)
      .join('_');
  }

  private resolveCategory(action: string, path: string) {
    if (action.startsWith('author_')) {
      return 'author';
    }
    if (action.startsWith('publication_')) {
      return 'publication';
    }
    if (action.startsWith('auth_')) {
      return 'auth';
    }
    if (action.includes('institution')) {
      return 'institution';
    }
    const firstPathSegment = path
      .split('?')[0]
      .split('/')
      .filter(Boolean)[0];
    return firstPathSegment?.toLowerCase() || 'system';
  }

  private resolveActor(request: AuthenticatedRequest, result?: unknown) {
    const requestUser = this.toPlainRecord(request.user);
    if (Object.keys(requestUser).length > 0) {
      return {
        id: this.readString(requestUser, ['sub', '_id', 'id']),
        email: this.readString(requestUser, ['email']),
        fullName: this.readString(requestUser, ['fullName', 'name']),
        type: 'authenticated_user',
      };
    }

    const resultUser = this.readRecord(result, ['user']);
    if (Object.keys(resultUser).length > 0) {
      return {
        id: this.readString(resultUser, ['_id', 'id', 'sub']),
        email: this.readString(resultUser, ['email']),
        fullName: this.readString(resultUser, ['fullName', 'name']),
        type: 'login_result',
      };
    }

    return {
      type: 'anonymous',
    };
  }

  private resolveEntity(
    action: string,
    request: AuthenticatedRequest,
    result?: unknown,
  ) {
    const authorId =
      this.readString(request.params ?? {}, ['id']) ||
      this.readString(request.query ?? {}, ['authorId']) ||
      this.readString(result, ['authorId', '_id', 'id', 'dbAuthorId']);
    const authorName =
      this.readString(result, ['authorName', 'fullName', 'displayName']) ||
      undefined;

    if (
      action.startsWith('author_') ||
      action === 'author_publications_list' ||
      action === 'author_publications_export_pdf' ||
      action === 'author_refresh_request'
    ) {
      return {
        type: 'author',
        id: authorId,
        name: authorName,
      };
    }

    if (action.startsWith('publication_')) {
      return {
        type: 'publication',
        id:
          this.readString(request.params ?? {}, ['id']) ||
          this.readString(result, ['_id', 'id']),
        name: this.readString(result, ['title']),
      };
    }

    return undefined;
  }

  private buildSummary(input: {
    action: string;
    request: AuthenticatedRequest;
    result?: unknown;
    error?: unknown;
  }) {
    if (input.error) {
      return {
        success: false,
        query: this.readString(input.request.query ?? {}, ['q']),
        message: this.readString(input.error, ['message']),
      };
    }

    switch (input.action) {
      case 'author_search':
        return this.buildAuthorSearchSummary(input.request, input.result);
      case 'author_detail_view':
        return this.buildAuthorDetailSummary(input.request, input.result);
      case 'author_publications_list':
      case 'author_publications_export_pdf':
        return this.buildPublicationListSummary(
          input.action,
          input.request,
          input.result,
        );
      case 'author_refresh_request':
        return this.buildAuthorRefreshRequestSummary(input.request, input.result);
      case 'author_publications_sync':
        return this.buildPublicationSyncSummary(input.request, input.result);
      case 'auth_login':
        return this.buildLoginSummary(input.request, input.result);
      default:
        return this.buildGenericSummary(input.request, input.result);
    }
  }

  private buildAuthorSearchSummary(
    request: AuthenticatedRequest,
    result?: unknown,
  ) {
    const items = this.readArray(result, ['items']);
    return {
      searchedQuery:
        this.readString(result, ['query']) ||
        this.readString(request.query ?? {}, ['q']) ||
        '',
      searchedTokens: this.extractSearchTokens(request.query?.q),
      requestedLimit: this.readNumber(request.query ?? {}, ['limit']) ?? undefined,
      filters: this.pickDefinedValues({
        country: this.readString(request.query ?? {}, ['country']),
        city: this.readString(request.query ?? {}, ['city']),
        school: this.readString(request.query ?? {}, ['school']),
        institution: this.readString(request.query ?? {}, ['institution']),
        university: this.readString(request.query ?? {}, ['university']),
      }),
      resultCount:
        this.readNumber(result, ['total']) ??
        (Array.isArray(items) ? items.length : 0),
      source: this.readString(result, ['source']) ?? undefined,
      providerCounts: this.readRecord(result, ['providers']),
      results: items.slice(0, 10).map((item) => ({
        authorId:
          this.readString(item, ['dbAuthorId', '_id', 'id']) ?? undefined,
        displayName:
          this.readString(item, ['displayName', 'fullName']) ?? undefined,
        score: this.readNumber(item, ['score']) ?? undefined,
        sourcePlatforms: this.extractSourcePlatforms(item),
      })),
    };
  }

  private buildAuthorDetailSummary(
    request: AuthenticatedRequest,
    result?: unknown,
  ) {
    return {
      authorId:
        this.readString(result, ['_id', 'id']) ||
        this.readString(request.params ?? {}, ['id']),
      authorName:
        this.readString(result, ['fullName', 'displayName']) ?? undefined,
      sourcePlatformCount: this.extractSourcePlatforms(result).length,
      sourcePlatforms: this.extractSourcePlatforms(result),
      institutionCanonicalKey:
        this.readString(result, ['institutionCanonicalKey']) ?? undefined,
      university: this.readString(result, ['university']) ?? undefined,
      city: this.readString(result, ['city']) ?? undefined,
      country: this.readString(result, ['country']) ?? undefined,
      profileSummaryParts: this.readArray(result, ['profileSummaryParts']).slice(
        0,
        8,
      ),
    };
  }

  private buildPublicationListSummary(
    action: string,
    request: AuthenticatedRequest,
    result?: unknown,
  ) {
    const publications = Array.isArray(result) ? result : [];
    return {
      format: action === 'author_publications_export_pdf' ? 'pdf' : 'json',
      authorId:
        this.readString(request.params ?? {}, ['id']) ||
        this.readString(request.query ?? {}, ['authorId']),
      query: this.readString(request.query ?? {}, ['q']) ?? undefined,
      publishedFrom:
        this.readString(request.query ?? {}, ['publishedFrom']) ?? undefined,
      publishedTo:
        this.readString(request.query ?? {}, ['publishedTo']) ?? undefined,
      years: this.readString(request.query ?? {}, ['years', 'yearWindow']) ?? undefined,
      publicationCount: publications.length,
      publications: publications.slice(0, 10).map((item) => ({
        id: this.readString(item, ['_id', 'id']) ?? undefined,
        title: this.readString(item, ['title']) ?? undefined,
        publishedYear: this.readNumber(item, ['publishedYear']) ?? undefined,
        doi: this.readString(item, ['doi']) ?? undefined,
        sourcePlatforms: this.extractSourcePlatforms(item, 'sourceRecords'),
      })),
    };
  }

  private buildPublicationSyncSummary(
    request: AuthenticatedRequest,
    result?: unknown,
  ) {
    const providers = this.readArray(result, ['providers']);
    return {
      authorId:
        this.readString(result, ['authorId']) ||
        this.readString(request.params ?? {}, ['id']),
      authorName: this.readString(result, ['authorName']) ?? undefined,
      force:
        this.readBoolean(result, ['force']) ??
        this.readBoolean(request.query ?? {}, ['force']) ??
        false,
      mode: this.readString(result, ['mode']) ?? undefined,
      dbHit: this.readBoolean(result, ['dbHit']) ?? undefined,
      totalHarvested: this.readNumber(result, ['totalHarvested']) ?? undefined,
      totalMerged: this.readNumber(result, ['totalMerged']) ?? undefined,
      totalUpserted: this.readNumber(result, ['totalUpserted']) ?? undefined,
      catalogCount: this.readNumber(result, ['catalogCount']) ?? undefined,
      filteredCount: this.readNumber(result, ['filteredCount']) ?? undefined,
      providerResults: providers.map((item) => ({
        platform:
          this.readString(item, ['platformKey', 'platform']) ?? undefined,
        status: this.readString(item, ['status']) ?? undefined,
        harvestedCount:
          this.readNumber(item, ['harvestedCount', 'harvested']) ?? undefined,
        mergedCount:
          this.readNumber(item, ['mergedCount', 'merged']) ?? undefined,
        upsertedCount:
          this.readNumber(item, ['upsertedCount', 'upserted']) ?? undefined,
        skippedReason:
          this.readString(item, ['skipReason', 'reason']) ?? undefined,
      })),
    };
  }

  private buildAuthorRefreshRequestSummary(
    request: AuthenticatedRequest,
    result?: unknown,
  ) {
    return {
      authorId:
        this.readString(result, ['authorId']) ||
        this.readString(request.params ?? {}, ['id']),
      authorName:
        this.readString(result, ['authorName']) ||
        this.readString(request.body ?? {}, ['authorName']) ||
        undefined,
      context:
        this.readString(result, ['context']) ||
        this.readString(request.body ?? {}, ['context']) ||
        undefined,
      profilePath:
        this.readString(result, ['profilePath']) ||
        this.readString(request.body ?? {}, ['profilePath']) ||
        undefined,
      requested: this.readBoolean(result, ['requested']) ?? true,
      status: this.readString(result, ['status']) ?? 'pending',
      message:
        this.readString(result, ['message']) ||
        'Veri yenileme istegi olusturuldu.',
    };
  }

  private buildLoginSummary(
    request: AuthenticatedRequest,
    result?: unknown,
  ) {
    const user = this.readRecord(result, ['user']);
    return {
      email:
        this.readString(user, ['email']) ||
        this.readString(request.body ?? {}, ['email']),
      userId: this.readString(user, ['_id', 'id']) ?? undefined,
      success: Object.keys(user).length > 0,
    };
  }

  private buildGenericSummary(
    request: AuthenticatedRequest,
    result?: unknown,
  ) {
    const genericArray = Array.isArray(result) ? result : [];
    return {
      query: this.readString(request.query ?? {}, ['q']) ?? undefined,
      resultCount:
        this.detectResultCount(result) ??
        (Array.isArray(result) ? genericArray.length : undefined),
      topResults: genericArray.slice(0, 5).map((item) => ({
        id: this.readString(item, ['_id', 'id']) ?? undefined,
        name:
          this.readString(item, ['displayName', 'fullName', 'title']) ??
          undefined,
      })),
      resultKeys:
        result && typeof result === 'object'
          ? Object.keys(this.toPlainRecord(result)).slice(0, 20)
          : [],
    };
  }

  private extractSearchTokens(value: unknown) {
    if (typeof value !== 'string' || !value.trim()) {
      return [];
    }

    return normalizePersonName(value)
      .split(' ')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private extractSourcePlatforms(
    value: unknown,
    fieldName: 'sourceProfiles' | 'sourceRecords' = 'sourceProfiles',
  ) {
    const items = this.readArray(value, [fieldName]);
    const platforms = new Set<string>();
    for (const item of items) {
      const platform =
        this.readString(item, ['platformKey', 'platform']) ?? undefined;
      if (platform) {
        platforms.add(platform);
      }
    }
    return Array.from(platforms);
  }

  private detectResultCount(result: unknown) {
    if (Array.isArray(result)) {
      return result.length;
    }

    return (
      this.readNumber(result, ['total']) ??
      this.readArray(result, ['items']).length ??
      this.readArray(result, ['publications']).length
    );
  }

  private detectResultType(result: unknown) {
    if (Array.isArray(result)) {
      return 'array';
    }
    if (result === null || result === undefined) {
      return 'empty';
    }
    return typeof result;
  }

  private sanitizeHeaders(headers: Record<string, unknown>) {
    return this.sanitizeValue(
      Object.fromEntries(
        Object.entries(headers).map(([key, value]) => [
          key,
          key.toLowerCase() === 'authorization' ? '[redacted]' : value,
        ]),
      ),
    );
  }

  private sanitizeValue(value: unknown, depth = 0): any {
    if (value === null || value === undefined) {
      return value;
    }

    if (depth >= MAX_DEPTH) {
      return '[max_depth_reached]';
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    if (Buffer.isBuffer(value)) {
      return `[buffer:${value.length}]`;
    }

    if (Array.isArray(value)) {
      return value.slice(0, MAX_ARRAY_ITEMS).map((item) =>
        this.sanitizeValue(item, depth + 1),
      );
    }

    if (typeof value === 'string') {
      return value.length > MAX_STRING_LENGTH
        ? `${value.slice(0, MAX_STRING_LENGTH)}...`
        : value;
    }

    if (
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      typeof value === 'bigint'
    ) {
      return value;
    }

    if (typeof value === 'object') {
      const plain = this.toPlainRecord(value);
      return Object.fromEntries(
        Object.entries(plain)
          .slice(0, MAX_OBJECT_KEYS)
          .map(([key, currentValue]) => [
            key,
            SENSITIVE_KEY_PATTERN.test(key)
              ? '[redacted]'
              : this.sanitizeValue(currentValue, depth + 1),
          ]),
      );
    }

    return String(value);
  }

  private resolveIp(request: AuthenticatedRequest) {
    const forwardedFor = request.headers['x-forwarded-for'];
    if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
      return forwardedFor.split(',')[0]?.trim();
    }
    if (Array.isArray(forwardedFor) && forwardedFor.length > 0) {
      return forwardedFor[0];
    }
    return request.ip;
  }

  private pickDefinedValues(value: Record<string, unknown>) {
    return Object.fromEntries(
      Object.entries(value).filter(([, item]) => item !== undefined && item !== ''),
    );
  }

  private readArray(value: unknown, paths: string[]) {
    const record = this.toPlainRecord(value);
    for (const path of paths) {
      const current = record[path];
      if (Array.isArray(current)) {
        return current.map((item) => this.toPlainRecord(item));
      }
    }
    return [];
  }

  private readRecord(value: unknown, paths: string[]) {
    const record = this.toPlainRecord(value);
    for (const path of paths) {
      const current = record[path];
      if (current && typeof current === 'object') {
        return this.toPlainRecord(current);
      }
    }
    return {};
  }

  private readString(value: unknown, paths: string[]) {
    const record = this.toPlainRecord(value);
    for (const path of paths) {
      const current = record[path];
      if (typeof current === 'string' && current.trim()) {
        return current.trim();
      }
      if (typeof current === 'number' || typeof current === 'bigint') {
        return String(current);
      }
      if (current && typeof current === 'object') {
        const text =
          typeof (current as { toString?: () => string }).toString === 'function'
            ? (current as { toString: () => string }).toString().trim()
            : '';
        if (text && text !== '[object Object]') {
          return text;
        }
      }
    }
    return undefined;
  }

  private readNumber(value: unknown, paths: string[]) {
    const record = this.toPlainRecord(value);
    for (const path of paths) {
      const current = record[path];
      if (typeof current === 'number' && Number.isFinite(current)) {
        return current;
      }
    }
    return undefined;
  }

  private readBoolean(value: unknown, paths: string[]) {
    const record = this.toPlainRecord(value);
    for (const path of paths) {
      const current = record[path];
      if (typeof current === 'boolean') {
        return current;
      }
      if (typeof current === 'string') {
        const normalized = current.trim().toLowerCase();
        if (['1', 'true', 'yes', 'on'].includes(normalized)) {
          return true;
        }
        if (['0', 'false', 'no', 'off'].includes(normalized)) {
          return false;
        }
      }
    }
    return undefined;
  }

  private toPlainRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object') {
      return {};
    }

    const maybeDoc = value as { toObject?: () => Record<string, unknown> };
    if (typeof maybeDoc.toObject === 'function') {
      return maybeDoc.toObject();
    }

    return value as Record<string, unknown>;
  }

  private escapeRegex(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
