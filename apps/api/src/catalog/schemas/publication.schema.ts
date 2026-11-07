import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { Author } from './author.schema';

export type PublicationDocument = HydratedDocument<Publication>;

@Schema({ _id: false })
export class SourceRecord {
  @Prop({ required: true })
  platform: string;

  @Prop()
  sourceId?: string;

  @Prop()
  sourceUrl?: string;

  @Prop({ type: Object })
  metadata?: Record<string, unknown>;
}

const SourceRecordSchema = SchemaFactory.createForClass(SourceRecord);

@Schema({ timestamps: true })
export class Publication {
  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ required: true, trim: true, index: true })
  normalizedTitle: string;

  @Prop({ trim: true, sparse: true, unique: true })
  doi?: string;

  @Prop({ required: true, trim: true, index: true })
  fingerprint: string;

  @Prop()
  journal?: string;

  @Prop({ type: Date })
  publishedAt?: Date;

  @Prop()
  publishedYear?: number;

  @Prop({ type: [String], default: [] })
  authors: string[];

  @Prop()
  authorsText?: string;

  @Prop()
  abstract?: string;

  @Prop()
  snippet?: string;

  @Prop({ type: [String], default: [] })
  keywords: string[];

  @Prop()
  publisher?: string;

  @Prop()
  volume?: string;

  @Prop()
  issue?: string;

  @Prop()
  pages?: string;

  @Prop()
  language?: string;

  @Prop()
  pmid?: string;

  @Prop()
  citationCount?: number;

  @Prop({ type: [{ type: Types.ObjectId, ref: Author.name }], default: [] })
  authorIds: Types.ObjectId[];

  @Prop({ type: [SourceRecordSchema], default: [] })
  sourceRecords: SourceRecord[];
}

export const PublicationSchema = SchemaFactory.createForClass(Publication);
PublicationSchema.index({ fingerprint: 1 }, { unique: true });
