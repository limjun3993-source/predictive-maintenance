import { getEquipmentById, getEventById, saveEventInsight } from "@/lib/db";
import { generateInsight } from "@/lib/insight";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const event = getEventById(Number(id));
  if (!event) {
    return Response.json({ error: "이벤트를 찾을 수 없습니다." }, { status: 404 });
  }

  const equipment = getEquipmentById(event.equipment_id);
  if (!equipment) {
    return Response.json({ error: "설비를 찾을 수 없습니다." }, { status: 404 });
  }

  if (event.ai_explanation) {
    return Response.json(event);
  }

  try {
    const insight = await generateInsight(equipment, event);
    saveEventInsight(event.id, insight);
    return Response.json(getEventById(event.id));
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI 설명 생성에 실패했습니다.";
    return Response.json({ error: message }, { status: 500 });
  }
}
