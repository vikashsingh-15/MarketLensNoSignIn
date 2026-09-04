import 'dotenv/config';

export const env = {
  port: Number(process.env.PORT || 8000),
  nodeEnv: process.env.NODE_ENV || 'development',
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/marketlens',
  sessionSecret: process.env.SESSION_SECRET || 'change-me',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  googleCallbackUrl: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:8000/api/auth/google/callback',
  cerebrasApiKey: process.env.CEREBRAS_API_KEY || '',
  cerebrasModel: process.env.CEREBRAS_MODEL || 'gpt-oss-120b',
  rssDevInterval: process.env.RSS_DEV_INTERVAL === 'true',
  rssRunOnStartup: process.env.RSS_RUN_ON_STARTUP !== 'false',
};
