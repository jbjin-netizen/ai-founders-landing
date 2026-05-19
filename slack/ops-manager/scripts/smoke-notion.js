// 1기 Notion 페이지를 실제 fetch해서 마크다운 결과 길이/샘플 출력.
// 사용법: node --env-file=.env scripts/smoke-notion.js
import { getNotionContext } from '../lib/notion.js';

console.log('Notion fetch 시작…');
const t0 = Date.now();
const md = await getNotionContext({ force: true });
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

console.log(`완료: ${elapsed}s, ${md.length.toLocaleString()} chars`);
console.log('--- 앞 800자 ---');
console.log(md.slice(0, 800));
console.log('--- 뒤 400자 ---');
console.log(md.slice(-400));
