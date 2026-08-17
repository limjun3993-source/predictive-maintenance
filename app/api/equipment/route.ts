import { getEquipmentSummaries } from "@/lib/db";
import { catchUpAllEquipment } from "@/lib/simulate";

export async function GET() {
  catchUpAllEquipment();
  return Response.json(getEquipmentSummaries());
}
