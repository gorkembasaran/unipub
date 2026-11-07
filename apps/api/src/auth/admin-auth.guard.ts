import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { AuthSessionUser } from './auth.types';

export type AdminAuthenticatedRequest = Request & {
  user?: AuthSessionUser;
};

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AdminAuthenticatedRequest>();
    const token = this.extractBearerToken(request.headers.authorization);
    const user = await this.authService.getSessionUserFromToken(token);

    if (!user.isAdmin) {
      throw new ForbiddenException('Admin yetkisi gerekli.');
    }

    request.user = user;
    return true;
  }

  private extractBearerToken(authorization?: string) {
    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Authorization Bearer token gerekli.');
    }

    const token = authorization.slice(7).trim();
    if (!token) {
      throw new UnauthorizedException('Authorization Bearer token gerekli.');
    }

    return token;
  }
}
