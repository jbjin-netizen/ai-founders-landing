const { chromium } = require('playwright');
const fs = require('fs');

const BASE = 'https://spartaclub-ai-founders-pre-order.vercel.app';
const OUT = '/tmp/qa_shots';
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });

  const results = [];
  function log(name, pass, detail = '') {
    const mark = pass ? '✅' : '❌';
    results.push({ name, pass, detail });
    console.log(`${mark} ${name}${detail ? ' — ' + detail : ''}`);
  }
  async function shot(name) {
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  }

  // ── 1. 페이지 로드
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await shot('01_hero');
  log('페이지 로드', true);

  // ── 2. Hero 메시지
  const heroTitle = await page.textContent('.hero-title');
  log('Hero: 수익화 미포함', !heroTitle.includes('수익화'), heroTitle.trim().slice(0, 50));
  log('Hero: 완주/런칭 포함', heroTitle.includes('불가능') || heroTitle.includes('완성'), heroTitle.trim().slice(0, 50));

  const heroBadge = await page.textContent('.hero-badge');
  log('Hero 배지: 남은 좌석 할인', heroBadge.includes('남은 좌석 할인'), heroBadge.trim());

  // ── 3. 가격 모드 (남은 좌석 할인)
  const priceNote = await page.textContent('#std-note');
  log('가격 노트: 남은 좌석 할인', priceNote.includes('남은 좌석 할인'), priceNote.trim());
  log('가격 마감: 5/15 포함', priceNote.includes('5/15'), priceNote.trim());

  // ── 4. 솔루션 카드 순서 (01 = 완주 실행구조)
  const sol4Titles = await page.$$eval('.sol4-title', els => els.map(e => e.textContent.trim()));
  log('솔루션 01: 완주 실행구조', sol4Titles[0]?.includes('완주'), sol4Titles[0]);
  log('솔루션 04: 수익화', sol4Titles[3]?.includes('수익화'), sol4Titles[3]);

  // ── 5. 커리큘럼 WEEK4 탭 색상 (text-muted)
  const w4Color = await page.$eval('.curr-tab-week--final', el => getComputedStyle(el).color);
  log('WEEK4 탭: 검정 아님', !w4Color.includes('0, 0, 0'), w4Color);

  // ── 6. 혜택 섹션
  await page.evaluate(() => document.querySelector('#benefits')?.scrollIntoView());
  await page.waitForTimeout(500);
  await shot('02_benefits');
  const benefitTitle = await page.textContent('#benefits .sec-title');
  log('혜택 타이틀: AI 파운더스에서 제공', benefitTitle.includes('AI 파운더스에서 제공'), benefitTitle.trim());
  const specialLabel = await page.textContent('.benefit-special-label');
  log('특별 혜택 블록 존재', specialLabel.includes('한정 특별 혜택'), specialLabel.trim());

  // ── 7. AX 세션 존재
  const sessionTitles = await page.$$eval('.bs-title', els => els.map(e => e.textContent.trim()));
  log('AX SESSION 01 존재', sessionTitles.some(t => t.includes('IT 업계')), '');
  log('AX SESSION 02 존재', sessionTitles.some(t => t.includes('의료')), '');

  // ── 8. FAQ 새 항목
  await page.evaluate(() => document.querySelector('#faq')?.scrollIntoView());
  await page.waitForTimeout(400);
  await shot('03_faq');
  const faqQuestions = await page.$$eval('.faq-q', els => els.map(e => e.textContent.trim()));
  log('FAQ: 팀 배정 질문', faqQuestions.some(q => q.includes('팀은 어떻게')), '');
  log('FAQ: 구독료 질문', faqQuestions.some(q => q.includes('구독료')), '');
  log('FAQ: 환불 질문', faqQuestions.some(q => q.includes('환불')), '');

  // ── 9. 케이스스터디 업무 자동화 카드
  await page.evaluate(() => document.querySelector('#cases')?.scrollIntoView());
  await page.waitForTimeout(400);
  await shot('04_cases');
  const caseMetrics = await page.$$eval('.case-metric', els => els.map(e => e.textContent.trim()));
  log('케이스: 업무자동화 카드 (1인+AI)', caseMetrics.some(m => m.includes('1인+AI')), '');
  log('케이스: 수익 15% 제거됨', !caseMetrics.some(m => m.includes('15%')), '');

  // ── 10. 4주 완주 후 문구
  await page.evaluate(() => document.querySelector('#after')?.scrollIntoView());
  await page.waitForTimeout(300);
  const afterText = await page.textContent('#after');
  log('4주 완주 후: 수익화 문구 제거', !afterText.includes("돈이 되는 구조"), afterText.trim().slice(0, 60));
  log('4주 완주 후: 새 문구', afterText.includes('막히는 구간'), '');

  // ── 11. 옵션 모달
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.locator('button').filter({ hasText: /신청하기/ }).first().click();
  await page.waitForTimeout(500);
  await shot('05_modal');
  const modalDesc = await page.textContent('.modal-option-desc');
  log('모달: Claude Code 경험 문구', modalDesc.includes('Claude Code'), modalDesc.trim());
  const modalPrices = await page.$$eval('.modal-option-price', els => els.map(e => e.textContent.trim()));
  log('모달 가격: 남은 좌석 할인', modalPrices.some(p => p.includes('남은 좌석 할인')), modalPrices[0]);

  // ── 12. 신청 퍼널 phase2
  await page.evaluate(() => window.startApply('standard'));
  await page.waitForTimeout(500);
  await shot('06_apply_phase1');
  log('신청 폼 Phase1 열림', await page.isVisible('#phase1'));

  await page.fill('#inp-name', '테스트');
  await page.fill('#inp-phone', '01012345678');
  await page.waitForTimeout(200);
  await shot('07_apply_form');

  const formLabel = await page.locator('#ai-exp-group').locator('..').locator('.form-label').textContent();
  log('신청 폼 라벨: Claude Code', formLabel.includes('Claude Code'), formLabel.trim());

  const radio1 = await page.locator('#phase1 .radio-item').nth(0).locator('.radio-text').textContent();
  log('라디오 1: VS Code 기준', radio1.includes('VS Code'), radio1.trim().slice(0, 50));

  // standard 옵션일 때 라디오 1 선택 시 rec-banner 표시
  await page.locator('#phase1 .radio-item').nth(0).click();
  await page.waitForTimeout(400);
  log('rec-banner: 라디오 1 선택 시 표시', await page.isVisible('#rec-banner.visible'));

  // ── 13. 모바일 Hero
  await page.setViewportSize({ width: 375, height: 812 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await shot('08_mobile_hero');
  log('모바일: Hero 렌더링', await page.isVisible('.hero-title'));

  await browser.close();

  // ── 결과
  console.log('\n─────────────────────────────');
  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  console.log(`결과: ${passed} passed / ${failed} failed`);
  if (failed > 0) {
    console.log('\n실패 항목:');
    results.filter(r => !r.pass).forEach(r => console.log(`  ❌ ${r.name}: ${r.detail}`));
  }
  process.exit(failed > 0 ? 1 : 0);
})();
