import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { AuthenticatedUser } from './auth.types';

export type AuthenticatedRequest = Request & {
  user?: AuthenticatedUser;
};

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractBearerToken(request.headers.authorization);
    request.user = this.authService.verifyAccessToken(token);
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
