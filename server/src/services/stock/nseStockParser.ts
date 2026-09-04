import type { IStockSymbolHistory } from '../../models/Stock.js';

export type NseEquityRow = {
  SYMBOL?: string;
  'NAME OF COMPANY'?: string;
  SERIES?: string;
  'DATE OF LISTING'?: string;
  'ISIN NUMBER'?: string;
};

export type NseSymbolChangeRow = { companyName?: string; oldSymbol?: string; newSymbol?: string; effectiveDate?: string };
export type NseNameChangeRow = { NCH_SYMBOL?: string; NCH_PREV_NAME?: string; NCH_NEW_NAME?: string; NCH_DT?: string };

export type PreparedEquity = {
  symbol: string;
  companyName: string;
  isin: string;
  listingDate?: Date;
  aliases: string[];
  symbolHistory: IStockSymbolHistory[];
  conflictingAliases: string[];
};

const monthNumbers: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

export function parseNseDate(value?: string) {
  const match = value?.trim().toUpperCase().match(/^(\d{2})-([A-Z]{3})-(\d{4})$/);
  if (!match || monthNumbers[match[2]] == null) return undefined;
  return new Date(Date.UTC(Number(match[3]), monthNumbers[match[2]], Number(match[1])));
}

export const normalizeSymbol = (value?: string) => value?.trim().toUpperCase() || '';
const normalizeText = (value?: string) => value?.replace(/\s+/g, ' ').trim() || '';
const identityKey = (value: string) => value.toLowerCase().replace(/\b(limited|ltd|india)\b/g, '').replace(/[^a-z0-9]/g, '');

function historicalSymbolsFor(currentSymbol: string, changes: NseSymbolChangeRow[]) {
  const byNewSymbol = new Map<string, NseSymbolChangeRow[]>();
  for (const change of changes) {
    const next = normalizeSymbol(change.newSymbol);
    const existing = byNewSymbol.get(next) || [];
    existing.push(change);
    byNewSymbol.set(next, existing);
  }

  const history: IStockSymbolHistory[] = [];
  const queue = [currentSymbol];
  const visited = new Set([currentSymbol]);
  while (queue.length) {
    const nextSymbol = queue.shift()!;
    for (const change of byNewSymbol.get(nextSymbol) || []) {
      const oldSymbol = normalizeSymbol(change.oldSymbol);
      if (!oldSymbol || visited.has(oldSymbol)) continue;
      visited.add(oldSymbol);
      history.push({ symbol: oldSymbol, effectiveTo: parseNseDate(change.effectiveDate) });
      queue.push(oldSymbol);
    }
  }
  return history;
}

export function prepareNseEquities(
  equityRows: NseEquityRow[],
  symbolChanges: NseSymbolChangeRow[] = [],
  nameChanges: NseNameChangeRow[] = [],
) {
  const prepared = equityRows.map((row): PreparedEquity => {
    const symbol = normalizeSymbol(row.SYMBOL);
    const companyName = normalizeText(row['NAME OF COMPANY']);
    const symbolHistory = historicalSymbolsFor(symbol, symbolChanges);
    const allSymbols = new Set([symbol, ...symbolHistory.map((item) => item.symbol)]);
    const historicalNames = nameChanges
      .filter((change) => allSymbols.has(normalizeSymbol(change.NCH_SYMBOL)))
      .flatMap((change) => [normalizeText(change.NCH_PREV_NAME), normalizeText(change.NCH_NEW_NAME)])
      .filter(Boolean);
    return {
      symbol,
      companyName,
      isin: normalizeSymbol(row['ISIN NUMBER']),
      listingDate: parseNseDate(row['DATE OF LISTING']),
      aliases: [...new Set([symbol, companyName, ...symbolHistory.map((item) => item.symbol), ...historicalNames])],
      symbolHistory,
      conflictingAliases: [],
    };
  });
  const currentIdentityOwners = new Map<string, Set<string>>();
  for (const equity of prepared) {
    for (const identity of [equity.symbol, equity.companyName]) {
      const owners = currentIdentityOwners.get(identityKey(identity)) || new Set<string>();
      owners.add(equity.symbol);
      currentIdentityOwners.set(identityKey(identity), owners);
    }
  }
  return prepared.map((equity) => {
    const ownCurrentIdentities = new Set([equity.symbol, equity.companyName]);
    const historicalSymbols = new Set(equity.symbolHistory.map((item) => item.symbol));
    const conflictingAliases = equity.aliases.filter((alias) => {
      if (ownCurrentIdentities.has(alias) || historicalSymbols.has(alias)) return false;
      const owners = currentIdentityOwners.get(identityKey(alias));
      return owners ? [...owners].some((owner) => owner !== equity.symbol) : false;
    });
    return {
      ...equity,
      aliases: equity.aliases.filter((alias) => !conflictingAliases.includes(alias)),
      conflictingAliases,
    };
  });
}
