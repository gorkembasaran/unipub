import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type InstitutionDocument = HydratedDocument<Institution>;

@Schema({ _id: false })
export class InstitutionPlatformAlias {
  @Prop({ required: true, trim: true })
  platform: string;

  @Prop({ type: [String], default: [] })
  names: string[];
}

const InstitutionPlatformAliasSchema = SchemaFactory.createForClass(
  InstitutionPlatformAlias,
);

@Schema({ timestamps: true })
export class Institution {
  @Prop({ required: true, trim: true, index: true })
  canonicalName: string;

  @Prop({ required: true, trim: true, index: true })
  normalizedKey: string;

  @Prop({ type: [String], default: [] })
  aliases: string[];

  @Prop({ type: [String], default: [] })
  manualAliases: string[];

  @Prop({ type: [String], default: [], index: true })
  matchKeys: string[];

  @Prop({ type: [InstitutionPlatformAliasSchema], default: [] })
  platformAliases: InstitutionPlatformAlias[];

  @Prop({ default: false })
  canonicalLocked: boolean;

  @Prop()
  city?: string;

  @Prop()
  country?: string;
}

export const InstitutionSchema = SchemaFactory.createForClass(Institution);
