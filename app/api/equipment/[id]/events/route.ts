import { getLiveEvents } from "@/lib/simulate";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return Response.json(getLiveEvents(Number(id)));
}
