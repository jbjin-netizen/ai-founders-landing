import {
  verifySlackSignature,
  postThreadReply,
  fetchChannelHistory,
  tutorMention,
} from '../lib/slack.js';
import { classify } from '../lib/classifier.js';
import { answerWithContext } from '../lib/claude.js';
import { getNotionContext } from '../lib/notion.js';

export const config = { api: { bodyParser: false } };

async function readRawBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString('utf-8');
}

const seenEventIds = new Set();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' });
  }
  const rawBody = await readRawBody(req);
  if (!verifySlackSignature(req, rawBody)) {
    return res.status(401).json({ error: 'invalid signature' });
  }
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: 'invalid json' });
  }

  if (payload.type === 'url_verification') {
    return res.status(200).json({ challenge: payload.challenge });
  }
  if (payload.type !== 'event_callback' || !payload.event) {
    return res.status(200).json({ ok: true });
  }

  // Slack 3초 룰: 우선 200을 회신하고 이후에 비동기로 처리
  res.status(200).json({ ok: true });

  const eventId = payload.event_id;
  if (eventId) {
    if (seenEventIds.has(eventId)) return;
    seenEventIds.add(eventId);
  }

  const event = payload.event;
  if (event.bot_id || event.subtype) return;
  if (event.type !== 'message' && event.type !== 'app_mention') return;

  const text = (event.text || '').trim();
  if (!text) return;

  const targetChannel = process.env.SLACK_CHANNEL_ID;
  if (targetChannel && event.channel !== targetChannel) return;

  try {
    await handleMessage(event, text);
  } catch (err) {
    console.error('handleMessage 실패:', err);
  }
}

async function handleMessage(event, text) {
  const channel = event.channel;
  const thread_ts = event.thread_ts || event.ts;

  const { category, confidence, reason } = await classify(text);
  console.log(`[classify] ${category} (${confidence}): ${reason}`);

  if (category === 'noise') return;

  const tutor = tutorMention(process.env.SLACK_TECH_TUTOR_USER_ID);

  if (category === 'tech') {
    await postThreadReply({
      channel,
      thread_ts,
      text: `${tutor} 님, 기술 관련 질문이 올라왔어요. 확인 부탁드릴게요! 🙏`,
    });
    return;
  }

  const [notionDoc, channelContext] = await Promise.all([
    getNotionContext().catch((e) => {
      console.error('Notion fetch 실패:', e);
      return '';
    }),
    fetchChannelHistory({
      channel,
      limit: Number(process.env.SLACK_HISTORY_LIMIT || 50),
    }).catch((e) => {
      console.error('history fetch 실패:', e);
      return '';
    }),
  ]);

  if (category === 'ambiguous') {
    const { text: draft } = await answerWithContext({
      question: text,
      notionDoc,
      channelContext,
      mode: 'ambiguous_draft',
    });
    await postThreadReply({
      channel,
      thread_ts,
      text: `${tutor} 님, 한 번 봐주세요. 운영 측면에서는 아래 정보가 도움 될 수 있어요 👇\n\n${draft}`,
    });
    return;
  }

  const { text: answer } = await answerWithContext({
    question: text,
    notionDoc,
    channelContext,
    mode: 'ops',
  });
  await postThreadReply({ channel, thread_ts, text: answer });
}
