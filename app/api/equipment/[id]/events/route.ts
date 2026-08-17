import { getEventsForEquipment } from "@/lib/db";
import { catchUpEquipment } from "@/lib/simulate";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  catchUpEquipment(Number(id));
  return Response.json(getEventsForEquipment(Number(id)));
}
