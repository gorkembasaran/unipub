import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { Institution } from './institution.schema';

export type AuthorDocument = HydratedDocument<Author>;

@Schema({ _id: false })
export class SourceProfile {
  @Prop({ required: true })
  platform: string;

  @Prop({ required: true })
  externalAuthorId: string;

  @Prop()
  profileUrl?: string;

  @Prop()
  score?: number;

  @Prop({ type: Date })
  lastSyncedAt?: Date;
}

const SourceProfileSchema = SchemaFactory.createForClass(SourceProfile);

@Schema({ timestamps: true })
export class Author {
  @Prop({ required: true, trim: true, index: true })
  fullName: string;

  @Prop({ required: true, trim: true, index: true })
  normalizedName: string;

  @Prop({ type: [String], default: [] })
  aliases: string[];

  @Prop({ type: [String], default: [] })
  affiliations: string[];

  @Prop({ type: [Object], default: [] })
  parsedAffiliations: Record<string, unknown>[];

  @Prop({ type: [String], default: [] })
  searchKeywords: string[];

  @Prop({ type: Types.ObjectId, ref: Institution.name })
  institutionId?: Types.ObjectId;

  @Prop()
  institutionCanonicalKey?: string;

  @Prop({ type: [String], default: [] })
  institutionAliases: string[];

  @Prop()
  university?: string;

  @Prop()
  city?: string;

  @Prop()
  country?: string;

  @Prop()
  emailDomain?: string;

  @Prop({ trim: true, sparse: true, unique: true })
  orcid?: string;

  @Prop({ type: [SourceProfileSchema], default: [] })
  sourceProfiles: SourceProfile[];
}

export const AuthorSchema = SchemaFactory.createForClass(Author);
AuthorSchema.index({ searchKeywords: 1 });
AuthorSchema.index({ institutionCanonicalKey: 1 });
AuthorSchema.index({ city: 1 });
AuthorSchema.index({ country: 1 });
AuthorSchema.index({
  'sourceProfiles.platform': 1,
  'sourceProfiles.externalAuthorId': 1,
});
