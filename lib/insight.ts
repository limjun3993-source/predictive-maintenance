import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import type { AnomalyEvent, Equipment } from "./types";

const InsightSchema = z.object({
  explanation: z.string().describe("이상 징후가 왜 발생했는지에 대한 설명"),
  recommendation: z.string().describe("현장 엔지니어를 위한 권장 조치"),
  estimatedSavingsKrw: z
    .number()
    .describe("조기 발견으로 절감 가능한 예상 비용(원)"),
});

export type Insight = z.infer<typeof InsightSchema>;

export async function generateInsight(
  equipment: Equipment,
  event: AnomalyEvent
): Promise<Insight> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error(
      "GEMINI_API_KEY가 설정되지 않았습니다. .env 파일을 확인하세요."
    );
  }

  const client = new GoogleGenAI({});
  const metricLabel = event.metric === "temperature" ? "온도" : "진동";

  const interaction = await client.interactions.create({
    model: "gemini-3.6-flash",
    system_instruction:
      "당신은 산업 설비 예지보전 전문가입니다. 센서 이상 징후 데이터를 보고 " +
      "현장 엔지니어가 이해할 수 있는 설명과 권장 조치를 한국어로 제공합니다.",
    input: `설비: ${equipment.name} (${equipment.type}, ${equipment.location})
지표: ${metricLabel}
측정값: ${event.value.toFixed(2)}
정상 범위 평균: ${event.baseline_mean.toFixed(2)}, 표준편차: ${event.baseline_std.toFixed(2)}
심각도: ${event.severity === "critical" ? "위험" : "주의"}

이 이상 징후에 대해 설명하고, 권장 조치와 조기 발견으로 절감 가능한 예상 비용(원)을 알려주세요.`,
    response_format: {
      type: "text",
      mime_type: "application/json",
      schema: z.toJSONSchema(InsightSchema),
    },
  });

  if (!interaction.output_text) {
    throw new Error("AI 설명 생성에 실패했습니다. 다시 시도해주세요.");
  }

  return InsightSchema.parse(JSON.parse(interaction.output_text));
}
