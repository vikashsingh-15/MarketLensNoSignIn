import { Schema, model } from 'mongoose';
export interface IBroker { name: string; aliases: string[] }
const schema = new Schema<IBroker>({
  name: { type: String, required: true, unique: true },
  aliases: { type: [String], default: [] },
});
export const Broker = model<IBroker>('Broker', schema);
