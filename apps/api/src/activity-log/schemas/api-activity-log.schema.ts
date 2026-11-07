import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ApiActivityLogDocument = HydratedDocument<ApiActivityLog>;

@Schema({ _id: false })
export class ApiActivityActor {
  @Prop()
  id?: string;

  @Prop()
  email?: string;

  @Prop()
  fullName?: string;

  @Prop({ default: 'anonymous' })
  type: string;
}

@Schema({ _id: false })
export class ApiActivityEntity {
  @Prop()
  type?: string;

  @Prop()
  id?: string;

  @Prop()
  name?: string;
}

@Schema({ _id: false })
export class ApiActivityRequestContext {
  @Prop({ required: true })
  method: string;

  @Prop({ required: true })
  path: string;

  @Prop({ required: true })
  originalUrl: string;

  @Prop()
  route?: string;

  @Prop()
  controllerName?: string;

  @Prop()
  handlerName?: string;

  @Prop({ type: Object, default: {} })
  params: Record<string, unknown>;

  @Prop({ type: Object, default: {} })
  query: Record<string, unknown>;

  @Prop({ type: Object, default: {} })
  body: Record<string, unknown>;

  @Prop({ type: Object, default: {} })
  headers: Record<string, unknown>;

  @Prop()
  ip?: string;

  @Prop()
  userAgent?: string;
}

@Schema({ _id: false })
export class ApiActivityResponseContext {
  @Prop({ required: true })
  statusCode: number;

  @Prop({ required: true })
  durationMs: number;

  @Prop({ required: true })
  success: boolean;
}

@Schema({ _id: false })
export class ApiActivityErrorContext {
  @Prop()
  name?: string;

  @Prop()
  message?: string;

  @Prop()
  statusCode?: number;
}

@Schema({ _id: false })
export class ApiActivityAdminEditor {
  @Prop()
  id?: string;

  @Prop()
  email?: string;

  @Prop()
  fullName?: string;
}

@Schema({ _id: false })
export class ApiActivityAdminState {
  @Prop({ default: 'open' })
  status: string;

  @Prop({ type: [String], default: [] })
  tags: string[];

  @Prop()
  note?: string;

  @Prop({ default: false })
  pinned: boolean;

  @Prop()
  updatedAt?: Date;

  @Prop({ type: ApiActivityAdminEditor })
  updatedBy?: ApiActivityAdminEditor;
}

const ApiActivityActorSchema =
  SchemaFactory.createForClass(ApiActivityActor);
const ApiActivityEntitySchema =
  SchemaFactory.createForClass(ApiActivityEntity);
const ApiActivityRequestContextSchema = SchemaFactory.createForClass(
  ApiActivityRequestContext,
);
const ApiActivityResponseContextSchema = SchemaFactory.createForClass(
  ApiActivityResponseContext,
);
const ApiActivityErrorContextSchema = SchemaFactory.createForClass(
  ApiActivityErrorContext,
);
const ApiActivityAdminEditorSchema = SchemaFactory.createForClass(
  ApiActivityAdminEditor,
);
const ApiActivityAdminStateSchema = SchemaFactory.createForClass(
  ApiActivityAdminState,
);

@Schema({
  timestamps: true,
  collection: 'api_activity_logs',
})
export class ApiActivityLog {
  @Prop({ required: true, index: true })
  requestId: string;

  @Prop({ required: true, index: true })
  action: string;

  @Prop({ required: true, index: true })
  category: string;

  @Prop({ type: ApiActivityActorSchema })
  actor?: ApiActivityActor;

  @Prop({ type: ApiActivityEntitySchema })
  entity?: ApiActivityEntity;

  @Prop({ type: ApiActivityRequestContextSchema, required: true })
  request: ApiActivityRequestContext;

  @Prop({ type: ApiActivityResponseContextSchema, required: true })
  response: ApiActivityResponseContext;

  @Prop({ type: ApiActivityErrorContextSchema })
  error?: ApiActivityErrorContext;

  @Prop({ type: Object, default: {} })
  summary: Record<string, unknown>;

  @Prop({ type: Object, default: {} })
  metadata: Record<string, unknown>;

  @Prop({ type: ApiActivityAdminStateSchema, default: () => ({}) })
  admin: ApiActivityAdminState;
}

export const ApiActivityLogSchema =
  SchemaFactory.createForClass(ApiActivityLog);

ApiActivityLogSchema.index({ createdAt: -1 });
ApiActivityLogSchema.index({ action: 1, createdAt: -1 });
ApiActivityLogSchema.index({ category: 1, createdAt: -1 });
ApiActivityLogSchema.index({ 'admin.status': 1, createdAt: -1 });
ApiActivityLogSchema.index({ 'admin.pinned': 1, createdAt: -1 });
ApiActivityLogSchema.index({ 'actor.id': 1, createdAt: -1 });
ApiActivityLogSchema.index({ 'entity.id': 1, createdAt: -1 });
ApiActivityLogSchema.index({ 'request.path': 1, createdAt: -1 });
