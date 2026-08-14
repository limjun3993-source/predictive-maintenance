import { getEquipmentSummaries } from "@/lib/db";

export async function GET() {
  return Response.json(getEquipmentSummaries());
}
