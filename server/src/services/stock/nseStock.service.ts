import axios from 'axios';
import { parse } from 'csv-parse/sync';
import type { AnyBulkWriteOperation } from 'mongoose';
import { Stock, type IStock } from '../../models/Stock.js';
import {
  normalizeSymbol,
  parseNseDate,
  prepareNseEquities,
  type NseEquityRow,
  type NseNameChangeRow,
  type NseSymbolChangeRow,
} from './nseStockParser.js';
import { invalidateStockNormalizationCache } from './normalization.service.js';

const NSE_EQUITY_MASTER = 'https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv';
const NSE_SYMBOL_CHANGES = 'https://nsearchives.nseindia.com/content/equities/symbolchange.csv';
const NSE_NAME_CHANGES = 'https://nsearchives.nseindia.com/content/equities/namechange.csv';
const MINIMUM_EXPECTED_EQUITIES = 1_000;
const MINIMUM_PREVIOUS_COVERAGE = 0.7;
const MASTER_MISSES_BEFORE_INACTIVE = 2;

export interface NseStockSyncSummary {
  equities: number;
  inserted: number;
  updated: number;
  renamed: number;
  symbolChangesApplied: number;
  markedPending: number;
  deactivated: number;
  warnings: string[];
  finishedAt: string;
}

async function downloadCsv(url: string, label: string) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { data } = await axios.get<string>(url, {
        timeout: 20_000,
        responseType: 'text',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MarketLens/1.0)', Accept: 'text/csv,*/*' },
      });
      if (typeof data !== 'string' || !data.trim()) throw new Error(`${label} returned an empty response`);
      return data;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 750));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${label} download failed`);
}

function parseEquities(data: string) {
  const rows = parse(data, { columns: true, skip_empty_lines: true, trim: true, bom: true }) as NseEquityRow[];
  return rows.filter((row) => row.SYMBOL && row['NAME OF COMPANY'] && row['ISIN NUMBER'] && (!row.SERIES || row.SERIES === 'EQ'));
}

function parseSymbolChanges(data: string) {
  const rows = parse(data, {
    columns: ['companyName', 'oldSymbol', 'newSymbol', 'effectiveDate'],
    skip_empty_lines: true,
    trim: true,
    bom: true,
    relax_column_count: true,
  }) as NseSymbolChangeRow[];
  return rows.filter((row) => normalizeSymbol(row.oldSymbol) && normalizeSymbol(row.newSymbol));
}

function parseNameChanges(data: string) {
  return parse(data, {
    columns: (header: string[]) => header.map((column) => column.trim()),
    skip_empty_lines: true,
    trim: true,
    bom: true,
    relax_column_count: true,
  }) as NseNameChangeRow[];
}

async function runNseStockSync(): Promise<NseStockSyncSummary> {
  const warnings: string[] = [];
  const masterData = await downloadCsv(NSE_EQUITY_MASTER, 'NSE equity master');
  const equityRows = parseEquities(masterData);
  const previousActiveCount = await Stock.countDocuments({ exchange: 'NSE', active: { $ne: false } });
  if (equityRows.length < MINIMUM_EXPECTED_EQUITIES) {
    throw new Error(`NSE equity master validation failed: received only ${equityRows.length} usable equities`);
  }
  if (previousActiveCount >= MINIMUM_EXPECTED_EQUITIES && equityRows.length < previousActiveCount * MINIMUM_PREVIOUS_COVERAGE) {
    throw new Error(`NSE equity master validation failed: ${equityRows.length} rows are unexpectedly low versus ${previousActiveCount} active NSE stocks`);
  }

  const [symbolChangeResult, nameChangeResult] = await Promise.allSettled([
    downloadCsv(NSE_SYMBOL_CHANGES, 'NSE symbol changes'),
    downloadCsv(NSE_NAME_CHANGES, 'NSE company-name changes'),
  ]);
  const symbolChanges = symbolChangeResult.status === 'fulfilled' ? parseSymbolChanges(symbolChangeResult.value) : [];
  const nameChanges = nameChangeResult.status === 'fulfilled' ? parseNameChanges(nameChangeResult.value) : [];
  if (symbolChangeResult.status === 'rejected') warnings.push('NSE symbol-change history was unavailable; current symbols were still synchronized.');
  if (nameChangeResult.status === 'rejected') warnings.push('NSE company-name history was unavailable; current names were still synchronized.');

  const equities = prepareNseEquities(equityRows, symbolChanges, nameChanges);
  const duplicateSymbols = equities.length - new Set(equities.map((equity) => equity.symbol)).size;
  const duplicateIsins = equities.length - new Set(equities.map((equity) => equity.isin)).size;
  if (duplicateSymbols || duplicateIsins) throw new Error(`NSE equity master validation failed: ${duplicateSymbols} duplicate symbols and ${duplicateIsins} duplicate ISINs`);

  const existingStocks = await Stock.find({ exchange: 'NSE' }).select('_id symbol isin').lean();
  await Stock.updateMany({ dataStatus: { $exists: false } }, { $set: { dataStatus: 'READY' } });
  const existingBySymbol = new Map(existingStocks.map((stock) => [stock.symbol, stock]));
  const existingByIsin = new Map(existingStocks.filter((stock) => stock.isin).map((stock) => [stock.isin!, stock]));
  const operations: AnyBulkWriteOperation<IStock>[] = [];
  let renamed = 0;
  for (const equity of equities) {
    const byIsin = existingByIsin.get(equity.isin);
    const byCurrentSymbol = existingBySymbol.get(equity.symbol);
    let existing = byIsin || byCurrentSymbol;
    if (byIsin && byCurrentSymbol && String(byIsin._id) !== String(byCurrentSymbol._id)) {
      warnings.push(`ISIN ${equity.isin} matches ${byIsin.symbol}, but current symbol ${equity.symbol} is already a different record; automatic merge was skipped.`);
      operations.push({
        updateOne: {
          filter: { _id: byCurrentSymbol._id },
          update: {
            $set: {
              companyName: equity.companyName,
              exchange: 'NSE',
              listingDate: equity.listingDate,
              active: true,
              lastSeenAt: new Date(),
              consecutiveMasterMisses: 0,
            },
            $unset: { inactiveSince: '', inactiveReason: '' },
            $addToSet: { aliases: { $each: equity.aliases }, symbolHistory: { $each: equity.symbolHistory } },
          },
        },
      });
      continue;
    }
    if (existing && existing.symbol !== equity.symbol && !byCurrentSymbol) renamed++;
    const filter = existing ? { _id: existing._id } : { symbol: equity.symbol };
    operations.push({
      updateOne: {
        filter,
        update: {
          $set: {
            symbol: equity.symbol,
            companyName: equity.companyName,
            exchange: 'NSE',
            isin: equity.isin,
            listingDate: equity.listingDate,
            active: true,
            lastSeenAt: new Date(),
            consecutiveMasterMisses: 0,
          },
          $unset: { inactiveSince: '', inactiveReason: '' },
          $addToSet: {
            aliases: { $each: equity.aliases },
            symbolHistory: { $each: equity.symbolHistory },
          },
        },
        upsert: !existing,
      },
    });
  }
  const writeResult = await Stock.bulkWrite(operations, { ordered: false });
  const aliasCleanupOperations: AnyBulkWriteOperation<IStock>[] = equities
    .filter((equity) => equity.conflictingAliases.length)
    .map((equity) => ({
      updateOne: {
        filter: { symbol: equity.symbol, exchange: 'NSE' },
        update: { $pullAll: { aliases: equity.conflictingAliases } },
      },
    }));
  if (aliasCleanupOperations.length) await Stock.bulkWrite(aliasCleanupOperations, { ordered: false });

  const currentSymbols = equities.map((equity) => equity.symbol);
  const currentSymbolSet = new Set(currentSymbols);
  const currentIsins = equities.map((equity) => equity.isin);
  const symbolChangeOperations: AnyBulkWriteOperation<IStock>[] = symbolChanges.flatMap((change) => {
    const oldSymbol = normalizeSymbol(change.oldSymbol);
    const newSymbol = normalizeSymbol(change.newSymbol);
    if (!oldSymbol || !newSymbol || oldSymbol === newSymbol || currentSymbolSet.has(oldSymbol) || !currentSymbolSet.has(newSymbol)) return [];
    return [{
      updateMany: {
        filter: { exchange: 'NSE', symbol: oldSymbol, active: { $ne: false } },
        update: {
          $set: {
            active: false,
            inactiveSince: parseNseDate(change.effectiveDate) || new Date(),
            inactiveReason: 'SYMBOL_CHANGED',
            dataStatus: 'PROVIDER_UNAVAILABLE',
            dataStatusReason: `NSE symbol changed to ${newSymbol}`,
            dataStatusUpdatedAt: new Date(),
          },
          $addToSet: { successorSymbols: newSymbol },
        },
      },
    }];
  });
  const symbolChangeWriteResult = symbolChangeOperations.length
    ? await Stock.bulkWrite(symbolChangeOperations, { ordered: false })
    : null;
  const symbolChangesApplied = symbolChangeWriteResult?.modifiedCount || 0;

  const missingFilter = {
    exchange: 'NSE',
    active: { $ne: false },
    symbol: { $nin: currentSymbols },
    isin: { $nin: currentIsins },
  };
  const deactivatedResult = await Stock.updateMany(
    { ...missingFilter, consecutiveMasterMisses: { $gte: MASTER_MISSES_BEFORE_INACTIVE - 1 } },
    {
      $set: {
        active: false,
        inactiveSince: new Date(),
        inactiveReason: 'MISSING_FROM_MASTER',
        dataStatus: 'PROVIDER_UNAVAILABLE',
        dataStatusReason: 'Security was absent from two consecutive validated NSE equity masters',
        dataStatusUpdatedAt: new Date(),
      },
      $inc: { consecutiveMasterMisses: 1 },
    },
  );
  const pendingResult = await Stock.updateMany(
    {
      ...missingFilter,
      $or: [
        { consecutiveMasterMisses: { $exists: false } },
        { consecutiveMasterMisses: { $lt: MASTER_MISSES_BEFORE_INACTIVE - 1 } },
      ],
    },
    { $inc: { consecutiveMasterMisses: 1 } },
  );
  invalidateStockNormalizationCache();

  return {
    equities: equities.length,
    inserted: writeResult.upsertedCount,
    updated: writeResult.modifiedCount,
    renamed,
    symbolChangesApplied,
    markedPending: pendingResult.modifiedCount,
    deactivated: deactivatedResult.modifiedCount,
    warnings,
    finishedAt: new Date().toISOString(),
  };
}

let activeSync: Promise<NseStockSyncSummary> | null = null;

export function syncNseStocks() {
  if (activeSync) return activeSync;
  activeSync = runNseStockSync().finally(() => { activeSync = null; });
  return activeSync;
}
