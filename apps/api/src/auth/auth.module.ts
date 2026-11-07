import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AdminAuthGuard } from './admin-auth.guard';
import { JwtAuthGuard } from './jwt-auth.guard';
import { User, UserSchema } from './schemas/user.schema';

@Module({
  imports: [MongooseModule.forFeature([{ name: User.name, schema: UserSchema }])],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, AdminAuthGuard],
  exports: [AuthService, JwtAuthGuard, AdminAuthGuard],
})
export class AuthModule {}
