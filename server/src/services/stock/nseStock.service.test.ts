import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyMarketDataError } from './marketDataError.js';
import { parseNseDate, prepareNseEquities } from './nseStockParser.js';

test('parses NSE dates without relying on locale-specific Date parsing', () => {
  assert.equal(parseNseDate('24-OCT-2025')?.toISOString(), '2025-10-24T00:00:00.000Z');
  assert.equal(parseNseDate('not-a-date'), undefined);
});

test('builds current symbol aliases and history across chained NSE symbol changes', () => {
  const prepared = prepareNseEquities(
    [
      {
        SYMBOL: 'TMPV',
        'NAME OF COMPANY': 'Tata Motors Passenger Vehicles Limited',
        SERIES: 'EQ',
        'DATE OF LISTING': '22-JUL-1998',
        'ISIN NUMBER': 'INE155A01022',
      },
      {
        SYMBOL: 'TMCV',
        'NAME OF COMPANY': 'Tata Motors Limited',
        SERIES: 'EQ',
        'DATE OF LISTING': '12-NOV-2025',
        'ISIN NUMBER': 'INE1TAE01010',
      },
    ],
    [
      { companyName: 'Tata Motors Limited', oldSymbol: 'TELCO', newSymbol: 'TATAMOTORS', effectiveDate: '26-DEC-2003' },
      { companyName: 'Tata Motors Passenger Vehicles Limited', oldSymbol: 'TATAMOTORS', newSymbol: 'TMPV', effectiveDate: '24-OCT-2025' },
    ],
    [{ NCH_SYMBOL: 'TATAMOTORS', NCH_PREV_NAME: 'Tata Engineering and Locomotive Company Limited', NCH_NEW_NAME: 'Tata Motors Limited', NCH_DT: '29-JUL-2003' }],
  );
  const stock = prepared.find((item) => item.symbol === 'TMPV')!;

  assert.equal(stock.symbol, 'TMPV');
  assert.equal(stock.isin, 'INE155A01022');
  assert.deepEqual(stock.symbolHistory.map((item) => item.symbol), ['TATAMOTORS', 'TELCO']);
  assert(stock.aliases.includes('TATAMOTORS'));
  assert(stock.aliases.includes('TELCO'));
  assert(stock.aliases.includes('Tata Engineering and Locomotive Company Limited'));
  assert(!stock.aliases.includes('Tata Motors Limited'));
  assert(stock.conflictingAliases.includes('Tata Motors Limited'));
});

test('distinguishes permanent symbol failures from transient provider failures', () => {
  assert.equal(classifyMarketDataError(new Error('Quote not found for symbol: TATAMOTORS.BO')).code, 'SYMBOL_NOT_FOUND');
  assert.equal(classifyMarketDataError(new Error('fetch failed')).code, 'TRANSIENT_PROVIDER_ERROR');
});
