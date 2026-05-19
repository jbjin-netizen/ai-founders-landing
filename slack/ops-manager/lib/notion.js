import { Client } from '@notionhq/client';

const notion = new Client({ auth: process.env.NOTION_API_KEY });

let cached = null;
let cachedAt = 0;
const TTL_MS = 10 * 60 * 1000;

export async function getNotionContext({ force = false } = {}) {
  const now = Date.now();
  if (!force && cached && now - cachedAt < TTL_MS) return cached;
  const rootId = process.env.NOTION_ROOT_PAGE_ID;
  if (!rootId) throw new Error('NOTION_ROOT_PAGE_ID 미설정');
  cached = await fetchPageRecursive(rootId, 0);
  cachedAt = now;
  return cached;
}

async function fetchPageRecursive(blockId, depth) {
  if (depth > 3) return '';
  const blocks = await fetchAllBlocks(blockId);
  const parts = [];
  for (const b of blocks) parts.push(await blockToMarkdown(b, depth));
  return parts.filter(Boolean).join('\n');
}

async function fetchAllBlocks(blockId) {
  const all = [];
  let cursor;
  do {
    const res = await notion.blocks.children.list({
      block_id: blockId,
      start_cursor: cursor,
      page_size: 100,
    });
    all.push(...res.results);
    cursor = res.next_cursor;
  } while (cursor);
  return all;
}

async function blockToMarkdown(block, depth) {
  const t = block.type;
  const data = block[t] || {};
  const text = (rt) => (rt || []).map((r) => r.plain_text || '').join('');
  let head = '';
  switch (t) {
    case 'paragraph': head = text(data.rich_text); break;
    case 'heading_1': head = `# ${text(data.rich_text)}`; break;
    case 'heading_2': head = `## ${text(data.rich_text)}`; break;
    case 'heading_3': head = `### ${text(data.rich_text)}`; break;
    case 'bulleted_list_item': head = `- ${text(data.rich_text)}`; break;
    case 'numbered_list_item': head = `1. ${text(data.rich_text)}`; break;
    case 'to_do': head = `- [${data.checked ? 'x' : ' '}] ${text(data.rich_text)}`; break;
    case 'quote':
    case 'callout': head = `> ${text(data.rich_text)}`; break;
    case 'toggle': head = text(data.rich_text); break;
    case 'code': head = '```' + (data.language || '') + '\n' + text(data.rich_text) + '\n```'; break;
    case 'child_page': {
      const inner = await fetchPageRecursive(block.id, depth + 1);
      return `\n## ${data.title}\n${inner}`;
    }
    case 'divider': case 'synced_block': case 'unsupported':
      return '';
    default:
      head = '';
  }
  // 컨테이너 블록(column_list/column/toggle/callout/list_item 등)이 자식을 가지면 인라인 재귀
  if (block.has_children) {
    const children = await fetchAllBlocks(block.id);
    const parts = [];
    for (const c of children) parts.push(await blockToMarkdown(c, depth));
    const childMd = parts.filter(Boolean).join('\n');
    return head ? `${head}\n${childMd}` : childMd;
  }
  return head;
}
