import { Schema, model } from 'mongoose';
export interface IPublisher { name: string; rssUrl?: string; rssUrls: string[]; webUrls: string[]; website: string; enabled: boolean }
const schema = new Schema<IPublisher>({
  name: { type: String, required: true, unique: true },
  rssUrl: String,
  rssUrls: { type: [String], default: [] },
  webUrls: { type: [String], default: [] },
  website: { type: String, required: true },
  enabled: { type: Boolean, default: true },
});
export const Publisher = model<IPublisher>('Publisher', schema);
