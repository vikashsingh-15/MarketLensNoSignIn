import assert from 'node:assert/strict';
import test from 'node:test';
import { textExplicitlyMentionsStock } from './normalization.service.js';

const globalEducation = { symbol: 'GLOBAL', companyName: 'Global Education Limited', aliases: ['GLOBAL', 'Global Education'] };
const retail = { symbol: 'RETAIL', companyName: 'JHS Svendgaard Retail Ventures Limited', aliases: ['RETAIL', 'JHS Svendgaard Retail Ventures'] };
const persistent = { symbol: 'PERSISTENT', companyName: 'Persistent Systems Limited', aliases: ['PERSISTENT', 'Persistent Systems'] };
const bse = { symbol: 'BSE', companyName: 'BSE Limited', aliases: ['BSE', 'Bombay Stock Exchange'] };
const wipro = { symbol: 'WIPRO', companyName: 'Wipro Limited', aliases: ['WIPRO', 'Wipro Ltd'] };

test('does not turn generic market words into stock mentions', () => {
  assert.equal(textExplicitlyMentionsStock('Global Markets: five big triggers to watch this week', globalEducation), false);
  assert.equal(textExplicitlyMentionsStock('Retail inflation and persistent price pressure concern investors', retail), false);
  assert.equal(textExplicitlyMentionsStock('Persistent inflation could keep interest rates elevated', persistent), false);
  assert.equal(textExplicitlyMentionsStock('FIIs raise stakes across several BSE 500 stocks', bse), false);
  assert.equal(textExplicitlyMentionsStock('Uflex shares surge 16% after Q1 profit zooms 630% YoY', wipro), false);
  assert.equal(textExplicitlyMentionsStock('Voltas shares in focus after Q1 profit surges 52%', wipro), false);
});

test('accepts explicit company phrases and ticker-qualified headlines', () => {
  assert.equal(textExplicitlyMentionsStock('Global Education reports strong quarterly enrollment growth', globalEducation), true);
  assert.equal(textExplicitlyMentionsStock('Persistent Systems wins a major transformation contract', persistent), true);
  assert.equal(textExplicitlyMentionsStock('BSE shares tumble after an analyst downgrade', bse), true);
  assert.equal(textExplicitlyMentionsStock('NSE:RETAIL shares gain after a new store announcement', retail), true);
  assert.equal(textExplicitlyMentionsStock('Wipro Stock Falls as Nifty 50 Exit Looms', wipro), true);
});
