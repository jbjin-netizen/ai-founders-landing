import crypto from 'node:crypto';

const SLACK_API = 'https://slack.com/api';

export function verifySlackSignature(req, rawBody) {
  const signature = req.headers['x-slack-signature'];
  const ts = req.headers['x-slack-request-timestamp'];
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!signature || !ts || !secret) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const base = `v0:${ts}:${rawBody}`;
  const computed = 'v0=' + crypto.createHmac('sha256', secret).update(base).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(computed));
  } catch {
    return false;
  }
}

async function slackPost(endpoint, body) {
  const res = await fetch(`${SLACK_API}/${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Slack ${endpoint} 실패: ${data.error}`);
  return data;
}

async function slackGet(endpoint, params) {
  const qs = new URLSearchParams(params);
  const res = await fetch(`${SLACK_API}/${endpoint}?${qs}`, {
    headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Slack ${endpoint} 실패: ${data.error}`);
  return data;
}

export function postThreadReply({ channel, thread_ts, text }) {
  return slackPost('chat.postMessage', { channel, thread_ts, text, mrkdwn: true });
}

export async function fetchChannelHistory({ channel, limit = 50 }) {
  const data = await slackGet('conversations.history', { channel, limit: String(limit) });
  return (data.messages || [])
    .filter((m) => !m.bot_id && m.text)
    .reverse()
    .map((m) => m.text)
    .join('\n---\n');
}

export function tutorMention(userId) {
  return userId ? `<@${userId}>` : '`@[기술 튜터] 조진호`';
}
