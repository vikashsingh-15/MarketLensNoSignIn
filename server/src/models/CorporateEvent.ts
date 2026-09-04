import { Schema, model, type Types } from 'mongoose';

export const corporateEventTypes = [
  'EARNINGS', 'DIVIDEND', 'MERGER', 'BUYBACK', 'BONUS', 'SPLIT', 'FUND_RAISE', 'AGM', 'BOARD_MEETING', 'OTHER',
] as const;

export type CorporateEventType = typeof corporateEventTypes[number];
export type CorporateEventStatus = 'SCHEDULED' | 'REVISED';

export interface ICorporateEvent {
  stock?: Types.ObjectId;
  source: 'BSE' | 'YAHOO' | 'NSE';
  sourceEventKey: string;
  bseCode?: string;
  securityName: string;
  eventType: CorporateEventType;
  eventTypes: CorporateEventType[];
  purpose: string;
  eventDate: Date;
  status: CorporateEventStatus;
  sourceUrl: string;
  dividendAmount?: number;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<ICorporateEvent>({
  stock: { type: Schema.Types.ObjectId, ref: 'Stock', index: true },
  source: { type: String, enum: ['BSE', 'YAHOO', 'NSE'], required: true, default: 'BSE' },
  sourceEventKey: { type: String, required: true, unique: true, index: true },
  bseCode: { type: String, index: true },
  securityName: { type: String, required: true, index: true },
  eventType: { type: String, enum: corporateEventTypes, required: true, index: true },
  eventTypes: { type: [{ type: String, enum: corporateEventTypes }], default: ['BOARD_MEETING'], index: true },
  purpose: { type: String, required: true },
  eventDate: { type: Date, required: true, index: true },
  status: { type: String, enum: ['SCHEDULED', 'REVISED'], required: true, default: 'SCHEDULED' },
  sourceUrl: { type: String, required: true },
  dividendAmount: { type: Number, min: 0 },
}, { timestamps: true });

schema.index({ eventDate: 1, eventType: 1 });
schema.index({ eventDate: 1, securityName: 1 });

export const CorporateEvent = model<ICorporateEvent>('CorporateEvent', schema);
