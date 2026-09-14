import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "../../../../../lib/server-auth";
import { query } from "../../../../../lib/db";
type Context = { params: Promise<{ id: string }> };
export async function POST(_request: NextRequest, { params }: Context) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false }, { status: 401 });
  const id = (await params).id;
  const result = await query(
    `UPDATE uploads SET review_status='withdrawn',status='withdrawn',media_delete_after=NULL,updated_at=now() WHERE id=$1 AND uploader_open_id=$2 AND review_status='pending' RETURNING id`,
    [id, user.openId],
  );
  if (!result.rowCount)
    return NextResponse.json(
      {
        success: false,
        message: "Only your pending submission can be withdrawn.",
      },
      { status: 409 },
    );
  return NextResponse.json({ success: true });
}
