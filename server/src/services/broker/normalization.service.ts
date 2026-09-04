import type { Types } from 'mongoose';
import { Broker } from '../../models/Broker.js';

const normalize = (value: string) => value.toLowerCase().replace(/\b(limited|ltd|india|financial|securities|research)\b/g, '').replace(/[^a-z0-9]/g, '');
const CACHE_TTL_MS = 5 * 60 * 1000;

type BrokerCandidate = { _id: Types.ObjectId; name: string; aliases: string[] };
let brokerCache: { expiresAt: number; records: BrokerCandidate[] } | null = null;

async function getBrokerCandidates() {
  if (brokerCache && brokerCache.expiresAt > Date.now()) return brokerCache.records;
  const records = await Broker.find().select('_id name aliases').lean() as unknown as BrokerCandidate[];
  brokerCache = { expiresAt: Date.now() + CACHE_TTL_MS, records };
  return records;
}

export async function resolveBroker(name?: string | null) {
  if (!name) return null;
  const cleanName = name.replace(/\s+/g, ' ').trim().slice(0, 100);
  if (cleanName.length < 2) return null;
  const candidate = normalize(cleanName);
  const brokers = await getBrokerCandidates();
  const existing = brokers.find((broker) => [broker.name, ...broker.aliases].some((value) => normalize(value) === candidate));
  if (existing) return existing;
  const created = await Broker.findOneAndUpdate({ name: cleanName }, { $setOnInsert: { name: cleanName, aliases: [] } }, { upsert: true, new: true });
  brokerCache = null;
  return created;
}
