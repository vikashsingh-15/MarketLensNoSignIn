import 'dotenv/config';

export const env = {
  port: Number(process.env.PORT || 8000),
  nodeEnv: process.env.NODE_ENV || 'development',
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/marketlens',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  cerebrasApiKey: process.env.CEREBRAS_API_KEY || '',
  cerebrasModel: process.env.CEREBRAS_MODEL || 'gpt-oss-120b',
  rssDevInterval: process.env.RSS_DEV_INTERVAL === 'true',
  rssRunOnStartup: process.env.RSS_RUN_ON_STARTUP !== 'false',
};
