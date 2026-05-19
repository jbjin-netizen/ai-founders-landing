import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();
const MODEL = process.env.ANTHROPIC_CLASSIFIER_MODEL || 'claude-haiku-4-5';

const SYSTEM = `당신은 AI 파운더스 1기 운영 슬랙(#파운더스_질문해결방) 메시지 분류기입니다.

수강생/운영진의 새 메시지를 다음 카테고리로 분류합니다:
- ops: 일정, 제출, 줌링크, 장소, 팀 배정, 정책 등 운영 관련 문의
- tech: 코드 오류, 환경 설정, API/SDK 에러 등 기술 도움이 필요한 문의
- ambiguous: 운영·기술 양쪽 해석이 가능하거나 확신이 낮은 경우
- noise: 인사·잡담·이미 답변된 reply·이모지·짧은 동의 등 봇이 응답할 필요가 없는 메시지

확신이 낮으면 ambiguous로 분류하세요. 짧은 한 줄 인사("감사합니다", "넵")는 noise입니다.`;

export async function classify(message) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 256,
    system: SYSTEM,
    messages: [{ role: 'user', content: `다음 메시지를 분류해주세요:\n\n"${message}"` }],
    tools: [
      {
        name: 'submit_classification',
        description: '메시지 분류 결과 제출',
        input_schema: {
          type: 'object',
          properties: {
            category: { type: 'string', enum: ['ops', 'tech', 'ambiguous', 'noise'] },
            confidence: { type: 'number', description: '0.0 ~ 1.0 확신도' },
            reason: { type: 'string', description: '한 줄 사유' },
          },
          required: ['category', 'confidence', 'reason'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'submit_classification' },
  });
  const toolUse = response.content.find((b) => b.type === 'tool_use');
  if (!toolUse) return { category: 'ambiguous', confidence: 0, reason: 'classifier 응답 누락' };
  return toolUse.input;
}
