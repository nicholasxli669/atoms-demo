import { NextResponse } from "next/server";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const project = await store.getProject(id);
  if (!project) return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  const [messages, versions] = await Promise.all([
    store.listMessages(id),
    store.listVersions(id),
  ]);
  return NextResponse.json({ project, messages, versions });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const project = await store.getProject(id);
  if (!project) return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { name?: string };
  if (body.name?.trim()) await store.updateProject(id, { name: body.name.trim() });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  await store.deleteProject(id);
  return NextResponse.json({ ok: true });
}
