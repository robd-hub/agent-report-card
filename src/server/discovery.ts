/**
 * GET /.well-known/x402: lists the paid endpoint for x402 directories such as
 * x402scan, which read this when someone adds the site, then probe it for its
 * 402. Only served on Vercel (route file written by scripts/prepare-server.ts).
 */
export function GET(request: Request): Response {
  const origin = new URL(request.url).origin;
  return new Response(
    JSON.stringify({
      version: 1,
      resources: [`${origin}/api/grade/`],
      instructions: "Agent Report Card grades AI agents A to F: real test tasks, a SERV Reasoning check and independent human reviewers on Reppo, with a public report and badge. POST {\"agent\": \"<OpenServ marketplace link or https address>\"} to /api/grade/ and pay in USDC on Base with x402.",
    }),
    { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" } },
  );
}
