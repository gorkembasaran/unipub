import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Response } from 'express';
import { randomUUID } from 'crypto';
import { tap } from 'rxjs/operators';
import { ActivityLogService } from './activity-log.service';
import { AuthenticatedRequest } from '../auth/jwt-auth.guard';

type LoggedRequest = AuthenticatedRequest & {
  activityLogRequestId?: string;
};

@Injectable()
export class ActivityLogInterceptor implements NestInterceptor {
  constructor(private readonly activityLogService: ActivityLogService) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const http = context.switchToHttp();
    const request = http.getRequest<LoggedRequest>();
    const response = http.getResponse<Response>();
    const controllerName = context.getClass().name;
    const handlerName = context.getHandler().name;
    const startedAt = Date.now();
    const requestId = this.ensureRequestId(request, response);

    return next.handle().pipe(
      tap({
        next: (result) => {
          void this.activityLogService.captureHttpActivity({
            requestId,
            request,
            response,
            controllerName,
            handlerName,
            durationMs: Date.now() - startedAt,
            result,
          });
        },
        error: (error) => {
          void this.activityLogService.captureHttpActivity({
            requestId,
            request,
            response,
            controllerName,
            handlerName,
            durationMs: Date.now() - startedAt,
            error,
          });
        },
      }),
    );
  }

  private ensureRequestId(request: LoggedRequest, response: Response) {
    if (request.activityLogRequestId) {
      return request.activityLogRequestId;
    }

    const headerValue = request.headers['x-request-id'];
    const requestId =
      typeof headerValue === 'string' && headerValue.trim()
        ? headerValue.trim()
        : randomUUID();
    request.activityLogRequestId = requestId;
    response.setHeader('x-request-id', requestId);
    return requestId;
  }
}
