import { getEventsForEquipment } from "@/lib/db";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return Response.json(getEventsForEquipment(Number(id)));
}
