import { auth } from "@/lib/auth";
import { testConnection } from "@/lib/dataforseo/client";

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as { login?: string; password?: string };
    if (!body.login || !body.password) {
      return Response.json(
        { error: "Missing login or password" },
        { status: 400 }
      );
    }

    const ok = await testConnection(body.login, body.password);
    return Response.json({ success: ok });
  } catch (error) {
    console.error("API key test error:", error);
    return Response.json({ error: "Connection test failed" }, { status: 500 });
  }
}
