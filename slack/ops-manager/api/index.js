// Vercel cron 호출용 엔드포인트. Notion 캐시 워밍업/리프레시 용도.
import { getNotionContext } from '../lib/notion.js';

export default async function handler(req, res) {
  const auth = req.headers['authorization'];
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  try {
    const doc = await getNotionContext({ force: true });
    res.status(200).json({
      ok: true,
      refreshedAt: new Date().toISOString(),
      docChars: doc.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
