import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

const BASE_SYSTEM = `당신은 AI 파운더스 1기 운영 슬랙의 "파운더스 안내데스크" 봇입니다.

[수강생 특성]
- 대부분 40~50대 비개발자입니다. 어려운 용어는 풀어서, 줄임말/영어 표현은 가급적 한국어로.
- 친절하고 따뜻한 응원조로 답합니다. 추궁·비교·위협조 금지.

[답변 규칙]
- 아래 [운영 안내 문서]와 [채널 최근 히스토리]만 근거로 답합니다. 추측 금지.
- 일정·금액·링크·장소는 문서에 명시된 그대로 인용합니다.
- 문서에서 답을 찾을 수 없으면, "해당 정보는 안내 문서에 없어 운영진이 직접 확인해드릴게요" 라고 솔직히 답합니다.
- 답변은 핵심부터, 3~5문장 이내로 간결하게.
- 끝에 짧은 응원 한마디(예: "끝까지 화이팅이에요 🙌")를 자연스럽게 곁들여도 좋습니다.`;

export async function answerWithContext({ question, notionDoc, channelContext, mode = 'ops' }) {
  const system = [
    { type: 'text', text: BASE_SYSTEM },
    {
      type: 'text',
      text: `[운영 안내 문서 — 노션]\n${notionDoc || '(문서를 불러오지 못했습니다.)'}`,
      cache_control: { type: 'ephemeral' },
    },
  ];

  const userContent = [];
  if (channelContext) {
    userContent.push({
      type: 'text',
      text: `[채널 최근 히스토리 — 운영 관련 논의 포함]\n${channelContext}`,
    });
  }
  if (mode === 'ambiguous_draft') {
    userContent.push({
      type: 'text',
      text: '아래 질문은 운영·기술 분류가 모호합니다. 기술튜터님께서 정확한 답을 드릴 예정이지만, 운영 측면에서 단서가 되는 정보가 있다면 짧은 "참고용 초안"으로 작성해주세요. 추측은 하지 마세요.',
    });
  }
  userContent.push({ type: 'text', text: `[수강생 질문]\n${question}` });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    thinking: { type: 'disabled' },
    output_config: { effort: 'low' },
    system,
    messages: [{ role: 'user', content: userContent }],
  });

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  return { text, usage: response.usage };
}
