import { getReadingsForEquipment } from "@/lib/db";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return Response.json(getReadingsForEquipment(Number(id)));
}
