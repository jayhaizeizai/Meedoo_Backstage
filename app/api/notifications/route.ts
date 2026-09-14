import { NextResponse } from "next/server";
import { query } from "../../../lib/db";
import { getCurrentUser } from "../../../lib/server-auth";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false }, { status: 401 });
  const result = await query<{
    id: string;
    message: string;
    kind: string;
    created_at: string;
    read_at: string | null;
  }>(
    `SELECT id,message,kind,created_at,read_at FROM notifications WHERE user_open_id=$1 ORDER BY created_at DESC LIMIT 10`,
    [user.openId],
  );
  return NextResponse.json({
    success: true,
    notifications: result.rows,
    unread: result.rows.filter((item) => !item.read_at).length,
  });
}

export async function PATCH() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false }, { status: 401 });
  await query(
    `UPDATE notifications SET read_at=COALESCE(read_at,now()) WHERE user_open_id=$1`,
    [user.openId],
  );
  return NextResponse.json({ success: true });
}
