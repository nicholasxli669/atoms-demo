import { NextResponse } from "next/server";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const projects = await store.listProjects();
  return NextResponse.json({ projects });
}

export async function POST(req: Request) {
  let name = "新应用";
  try {
    const body = (await req.json()) as { name?: string };
    if (body?.name?.trim()) name = body.name.trim();
  } catch {
    /* 空 body 也允许 */
  }
  const project = await store.createProject(name);
  return NextResponse.json({ project }, { status: 201 });
}
