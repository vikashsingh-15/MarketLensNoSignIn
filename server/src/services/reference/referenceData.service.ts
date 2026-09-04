import { Stock } from '../../models/Stock.js';
import { Broker } from '../../models/Broker.js';
import { Publisher } from '../../models/Publisher.js';

const stocks = [
  ['TCS', 'Tata Consultancy Services', ['TCS Ltd', 'Tata Consultancy']],
  ['INFY', 'Infosys', ['Infosys Ltd', 'Infosys Limited']],
  ['RELIANCE', 'Reliance Industries', ['RIL', 'Reliance Industries Ltd']],
  ['HDFCBANK', 'HDFC Bank', ['HDFC Bank Ltd']],
  ['ICICIBANK', 'ICICI Bank', ['ICICI Bank Ltd']],
  ['SBIN', 'State Bank of India', ['SBI', 'State Bank']],
  ['M&M', 'Mahindra & Mahindra', ['M&M Ltd', 'Mahindra and Mahindra']],
  ['TMPV', 'Tata Motors Passenger Vehicles Limited', ['TATAMOTORS', 'Tata Motors Passenger Vehicles', 'Tata Motors Passenger Vehicles Ltd']],
  ['TMCV', 'Tata Motors Limited', ['TML Commercial Vehicles', 'Tata Motors Commercial Vehicles']],
  ['BHARTIARTL', 'Bharti Airtel', ['Airtel', 'Bharti Airtel Ltd']],
  ['ITC', 'ITC Limited', ['ITC Ltd']],
] as const;

const supplementalStocks = [
  { symbol: 'TANFACIND', companyName: 'Tanfac Industries Limited', exchange: 'BSE', aliases: ['Tanfac Ind'] },
  { symbol: 'LODHA', companyName: 'Lodha Developers Limited', exchange: 'NSE', aliases: ['Macrotech Developers'] },
  { symbol: 'GMRAIRPORT', companyName: 'GMR Airports Limited', exchange: 'NSE', aliases: ['GMR Infra'] },
] as const;

export const REFERENCE_STOCK_SYMBOLS = [...stocks.map(([symbol]) => symbol), ...supplementalStocks.map((stock) => stock.symbol)];

const brokers = [
  ['Jefferies', ['Jefferies India', 'Jefferies Financial']], ['Nomura', ['Nomura India']],
  ['CLSA', ['CLSA India']], ['Morgan Stanley', ['Morgan Stanley India']],
  ['JP Morgan', ['JPMorgan', 'J.P. Morgan']], ['Goldman Sachs', ['Goldman Sachs India']],
  ['Kotak Institutional Equities', ['Kotak Equities', 'Kotak Institutional']],
  ['Motilal Oswal', ['MOSL', 'Motilal Oswal Financial Services']],
] as const;

const publishers = [
  {
    name: 'ET Markets',
    rssUrl: 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms',
    rssUrls: ['https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms'],
    webUrls: ['https://economictimes.indiatimes.com/markets/stock-recos/newrecos/all'],
    website: 'https://economictimes.indiatimes.com/markets',
    enabled: true,
  },
  {
    name: 'Moneycontrol',
    // Desktop RSS/listing endpoints reject server requests with HTTP 403.
    // Moneycontrol's public mobile listing exposes the stock-advice links.
    rssUrl: '',
    rssUrls: [],
    webUrls: ['https://m.moneycontrol.com/markets/stock-advice/'],
    website: 'https://www.moneycontrol.com',
    enabled: true,
  },
  { name: 'Mint', rssUrl: 'https://www.livemint.com/rss/markets', rssUrls: ['https://www.livemint.com/rss/markets'], webUrls: ['https://www.livemint.com/market/stocks-to-buy-coverage'], website: 'https://www.livemint.com/market', enabled: true },
  {
    name: 'BusinessLine',
    rssUrls: [
      'https://www.thehindubusinessline.com/markets/stock-markets/feeder/default.rss',
      'https://www.thehindubusinessline.com/markets/feeder/default.rss',
      'https://www.thehindubusinessline.com/portfolio/technical-analysis/feeder/default.rss',
      'https://www.thehindubusinessline.com/portfolio/news-analysis/feeder/default.rss',
      'https://www.thehindubusinessline.com/portfolio/stock-fundamental-analysis-india/feeder/default.rss',
      'https://www.thehindubusinessline.com/portfolio/day-trading-guide/feeder/default.rss',
    ],
    webUrls: [], website: 'https://www.thehindubusinessline.com', enabled: true,
  },
  {
    name: 'The Hindu',
    rssUrls: [
      'https://www.thehindu.com/business/markets/feeder/default.rss',
      'https://www.thehindu.com/business/Economy/feeder/default.rss',
      'https://www.thehindu.com/news/national/feeder/default.rss',
    ],
    webUrls: [], website: 'https://www.thehindu.com', enabled: true,
  },
  {
    name: 'Indian Express',
    rssUrls: [
      'https://indianexpress.com/section/business/economy/feed/',
      'https://indianexpress.com/section/business/feed/',
      'https://indianexpress.com/section/cities/delhi/feed/',
    ],
    webUrls: [], website: 'https://indianexpress.com', enabled: true,
  },
  {
    name: 'Times of India',
    rssUrls: [
      'https://timesofindia.indiatimes.com/rssfeedstopstories.cms',
      'https://timesofindia.indiatimes.com/rssfeeds/-2128936835.cms',
      'https://timesofindia.indiatimes.com/rssfeedsvideo/3813458.cms',
    ],
    webUrls: [], website: 'https://timesofindia.indiatimes.com', enabled: true,
  },
  {
    name: 'CNBC TV18',
    rssUrls: [
      'https://www.cnbctv18.com/commonfeeds/v1/cne/rss/economy.xml',
      'https://www.cnbctv18.com/commonfeeds/v1/cne/rss/business.xml',
      'https://www.cnbctv18.com/commonfeeds/v1/cne/rss/market.xml',
      'https://www.cnbctv18.com/commonfeeds/v1/cne/rss/india.xml',
    ],
    webUrls: [], website: 'https://www.cnbctv18.com', enabled: true,
  },
  {
    name: 'MarketWatch',
    rssUrls: [
      'https://feeds.content.dowjones.io/public/rss/mw_realtimeheadlines',
      'https://feeds.content.dowjones.io/public/rss/mw_bulletins',
      'https://feeds.content.dowjones.io/public/rss/mw_marketpulse',
      'https://feeds.content.dowjones.io/public/rss/mw_topstories',
    ],
    webUrls: [], website: 'https://www.marketwatch.com', enabled: true,
  },
  { name: 'Trendlyne', rssUrls: [], webUrls: ['https://trendlyne.com/research-reports/all/'], website: 'https://trendlyne.com', enabled: true },
  { name: 'Business Standard', rssUrls: [], webUrls: ['https://www.business-standard.com/markets/research-report'], website: 'https://www.business-standard.com/markets', enabled: true },
  { name: 'ICICI Direct', rssUrls: [], webUrls: ['https://www.icicidirect.com/research/equity/investing-ideas'], website: 'https://www.icicidirect.com/research/equity', enabled: true },
];

export async function ensureReferenceData() {
  await Stock.bulkWrite([
    ...stocks.map(([symbol, companyName, aliases]) => ({
      updateOne: {
        filter: { symbol },
        update: {
          $set: { symbol, companyName, exchange: 'NSE' },
          $addToSet: { aliases: { $each: [symbol, companyName, ...aliases] } },
        },
        upsert: true,
      },
    })),
    ...supplementalStocks.map(({ symbol, companyName, exchange, aliases }) => ({
      updateOne: {
        filter: { symbol },
        update: {
          $set: { symbol, companyName, exchange },
          $addToSet: { aliases: { $each: [symbol, companyName, ...aliases] } },
        },
        upsert: true,
      },
    })),
  ]);
  await Broker.bulkWrite(brokers.map(([name, aliases]) => ({ updateOne: { filter: { name }, update: { $set: { name, aliases: [...aliases] } }, upsert: true } })));
  await Publisher.bulkWrite(publishers.map((publisher) => ({ updateOne: { filter: { name: publisher.name }, update: { $set: publisher }, upsert: true } })));
  return { stocks: stocks.length + supplementalStocks.length, brokers: brokers.length, publishers: publishers.length };
}
