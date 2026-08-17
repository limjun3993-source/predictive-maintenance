import { getLiveEquipmentSummaries } from "@/lib/simulate";

export async function GET() {
  return Response.json(getLiveEquipmentSummaries());
}
