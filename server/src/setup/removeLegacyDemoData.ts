import mongoose from 'mongoose';
import { connectDatabase } from '../config/db.js';
import { Article } from '../models/Article.js';
import { Recommendation } from '../models/Recommendation.js';

async function removeLegacyDemoData() {
  await connectDatabase();
  const articles = await Article.find({ url: /^https:\/\/example\.com\/marketlens\/seed-\d+$/ }).select('_id').lean();
  const articleIds = articles.map((article) => article._id);
  const recommendations = articleIds.length ? await Recommendation.deleteMany({ article: { $in: articleIds } }) : { deletedCount: 0 };
  const removedArticles = articleIds.length ? await Article.deleteMany({ _id: { $in: articleIds } }) : { deletedCount: 0 };
  console.log(`Removed ${removedArticles.deletedCount} legacy sample articles and ${recommendations.deletedCount} linked recommendations.`);
  await mongoose.disconnect();
}

removeLegacyDemoData().catch(async (error) => { console.error('Legacy-data cleanup failed:', error); await mongoose.disconnect(); process.exit(1); });
