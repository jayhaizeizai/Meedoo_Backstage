import { rm } from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { query } from "../../../../lib/db";
import { getCurrentUser } from "../../../../lib/server-auth";
import {
  getOwnedUploadSession,
  receivedChunks,
} from "../../../../lib/upload-staging";

type Context = { params: Promise<{ id: string }> };
export async function GET(_request: NextRequest, { params }: Context) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false }, { status: 401 });
  const { id } = await params;
  const session = await getOwnedUploadSession(id, user.openId);
  if (!session)
    return NextResponse.json(
      { success: false, message: "Upload session not found." },
      { status: 404 },
    );
  if (new Date(session.expires_at).getTime() < Date.now())
    return NextResponse.json(
      { success: false, message: "Upload session expired." },
      { status: 410 },
    );
  const chunks = await receivedChunks(id);
  return NextResponse.json({
    success: true,
    id,
    status: session.status,
    chunkSize: session.chunk_size,
    totalChunks: session.total_chunks,
    expectedSize: Number(session.expected_size),
    receivedChunks: chunks.map((item) => item.chunk_index),
    expiresAt: session.expires_at,
  });
}

export async function DELETE(_request: NextRequest, { params }: Context) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false }, { status: 401 });
  const { id } = await params;
  const session = await getOwnedUploadSession(id, user.openId);
  if (!session)
    return NextResponse.json(
      { success: false, message: "Upload session not found." },
      { status: 404 },
    );
  if (!["uploading", "assembling", "ready", "failed"].includes(session.status))
    return NextResponse.json(
      { success: false, message: "Submitted media cannot be cancelled." },
      { status: 409 },
    );
  if (session.media_path)
    await rm(session.media_path, { force: true }).catch(() => undefined);
  await query(
    `UPDATE upload_sessions SET expires_at=now(),status='failed',error_message='Cancelled by user',updated_at=now() WHERE id=$1`,
    [id],
  );
  return NextResponse.json({ success: true });
}
