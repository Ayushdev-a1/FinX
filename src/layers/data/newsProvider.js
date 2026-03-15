import { logger } from "../../utils/logger.js";

const POSITIVE_WORDS = ["beat", "growth", "upgrade", "profit", "expands", "surge"];
const NEGATIVE_WORDS = ["miss", "downgrade", "loss", "lawsuit", "cuts", "decline"];

export class MockNewsProvider {
  async getSentiment(symbol) {
    const rnd = (Math.random() - 0.5) * 2;
    return { symbol, sentimentScore: Number(rnd.toFixed(3)), source: "mock" };
  }
}

export class NewsApiProvider {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.fallback = new MockNewsProvider();
  }

  async getSentiment(symbol) {
    try {
      const q = encodeURIComponent(symbol.split(".")[0]);
      const url = `https://newsapi.org/v2/everything?q=${q}&pageSize=20&sortBy=publishedAt&apiKey=${this.apiKey}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`NewsAPI failed: ${res.status}`);
      const json = await res.json();
      const articles = json.articles || [];

      let score = 0;
      for (const a of articles) {
        const text = `${a.title || ""} ${a.description || ""}`.toLowerCase();
        for (const w of POSITIVE_WORDS) if (text.includes(w)) score += 1;
        for (const w of NEGATIVE_WORDS) if (text.includes(w)) score -= 1;
      }

      const normalized = articles.length ? score / articles.length : 0;
      return { symbol, sentimentScore: Number(normalized.toFixed(3)), source: "newsapi" };
    } catch (err) {
      logger.warn(`News provider failed, falling back to mock sentiment: ${err?.message || err}`);
      return this.fallback.getSentiment(symbol);
    }
  }
}

export function buildNewsProvider(env) {
  if (env.newsApiKey) {
    logger.info("Using NewsAPI provider for sentiment.");
    return new NewsApiProvider(env.newsApiKey);
  }

  logger.warn("NEWS_API_KEY missing, using mock sentiment provider.");
  return new MockNewsProvider();
}
