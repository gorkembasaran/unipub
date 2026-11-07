import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { User, UserDocument } from './schemas/user.schema';
import { AuthPayload, AuthSessionUser } from './auth.types';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly configService: ConfigService,
  ) {}

  async register(fullName: string, email: string, password: string) {
    const normalizedEmail = email.trim().toLowerCase();
    if (!fullName.trim() || !normalizedEmail || !password) {
      throw new BadRequestException('fullName, email ve password zorunlu.');
    }

    const existing = await this.userModel.findOne({ email: normalizedEmail }).lean();
    if (existing) {
      throw new BadRequestException('Bu email zaten kayitli.');
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await this.userModel.create({
      fullName: fullName.trim(),
      email: normalizedEmail,
      passwordHash,
    });

    const token = this.signToken({
      sub: user._id.toString(),
      email: user.email,
      fullName: user.fullName,
    });

    return { token, user: this.sanitize(user) };
  }

  async login(email: string, password: string) {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !password) {
      throw new BadRequestException('email ve password zorunlu.');
    }

    const user = await this.userModel.findOne({ email: normalizedEmail });
    if (!user) {
      throw new UnauthorizedException('Email veya sifre hatali.');
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('Email veya sifre hatali.');
    }

    const token = this.signToken({
      sub: user._id.toString(),
      email: user.email,
      fullName: user.fullName,
    });

    return { token, user: this.sanitize(user) };
  }

  async me(token: string) {
    return { user: await this.getSessionUserFromToken(token) };
  }

  async getSessionUserFromToken(token: string): Promise<AuthSessionUser> {
    const payload = this.verifyAccessToken(token);
    const user = await this.userModel.findById(payload.sub).lean();
    if (!user) {
      throw new UnauthorizedException('Gecersiz token.');
    }
    return this.sanitize(user);
  }

  private getJwtSecret() {
    const secret = this.configService.get<string>('JWT_SECRET');
    if (secret) {
      return secret;
    }
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET must be set in production.');
    }
    return 'dev_secret';
  }

  private signToken(payload: AuthPayload) {
    const secret = this.getJwtSecret();
    const expiresIn = this.configService.get<string>('JWT_EXPIRES_IN') ?? '7d';
    return jwt.sign(payload, secret, { expiresIn });
  }

  verifyAccessToken(token: string) {
    const secret = this.getJwtSecret();
    try {
      return jwt.verify(token, secret) as AuthPayload;
    } catch {
      throw new UnauthorizedException('Gecersiz token.');
    }
  }

  private sanitize(
    user: UserDocument | { _id?: unknown; fullName: string; email: string; isAdmin?: boolean },
  ): AuthSessionUser {
    const userObj = 'toObject' in user ? user.toObject() : user;
    const rawId =
      (userObj as { _id?: unknown })._id?.toString?.() ??
      (userObj as { _id?: unknown })._id;
    return {
      _id: typeof rawId === 'string' ? rawId : String(rawId ?? ''),
      fullName: userObj.fullName,
      email: userObj.email,
      isAdmin: Boolean(userObj.isAdmin),
    };
  }
}
