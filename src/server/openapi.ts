/**
 * GET /openapi.json: the paid grading endpoint as an OpenAPI document, which
 * is how x402 directories such as x402scan find it now (they no longer read
 * /.well-known/x402). Only served on Vercel (route file written by
 * scripts/prepare-server.ts).
 */
import { GRADE_PRICE_USD, REGRADE_PRICE_USD } from "@/lib/links";
import { openApiOperation } from "@/lib/x402";
import { offer } from "@/server/grade";

export function GET(request: Request): Response {
  const origin = new URL(request.url).origin;
  const doc = {
    openapi: "3.1.0",
    info: {
      title: "Agent Report Card",
      version: "1.0.0",
      description: "Independent A to F grades for AI agents: real test tasks, a SERV Reasoning check and Reppo's independent judges, with a public report and badge.",
      "x-guidance": `POST {"agent": "<OpenServ marketplace link or https address>"} to /api/grade/ and pay $${GRADE_PRICE_USD} in USDC on Base with x402 ($${REGRADE_PRICE_USD} to regrade an agent already graded). Call once without payment to get the 402 with the price. Before hiring an agent, check it for free: GET /api/lookup/?agent=<id, name, marketplace link, or https address> returns the grade and a hire, caution or avoid recommendation. GET /api/agents/?grade=A lists graded agents. MCP tools for the same reads are at /api/mcp. GET /api/trust/ and GET /api/best/ are the same grades in the earlier shape.`,
    },
    servers: [{ url: origin }],
    paths: {
      "/api/grade/": { post: openApiOperation(offer(GRADE_PRICE_USD), "Grade an AI agent A to F") },
      "/api/lookup/": {
        get: {
          operationId: "lookupAgentGrade",
          summary: "Free pre-hire lookup. No payment.",
          parameters: [{ name: "agent", in: "query", required: true, schema: { type: "string" }, description: "Id, name, OpenServ marketplace link or number, or the agent's own https address" }],
          responses: { "200": { description: "Grade, score, recommendation (hire, caution, avoid), report and badge URLs. status not_graded when we have no grade." } },
        },
      },
      "/api/agents/": {
        get: {
          operationId: "searchGradedAgents",
          summary: "Free list of graded agents. No payment.",
          parameters: [
            { name: "grade", in: "query", schema: { type: "string" }, description: "A to F, comma-separated" },
            { name: "category", in: "query", schema: { type: "string" }, description: "research, writing, crypto, code-data, or assistants" },
            { name: "recommendation", in: "query", schema: { type: "string" }, description: "hire, caution, or avoid" },
            { name: "q", in: "query", schema: { type: "string" } },
            { name: "limit", in: "query", schema: { type: "integer" } },
          ],
          responses: { "200": { description: "Highest score first." } },
        },
      },
    },
  };
  return new Response(JSON.stringify(doc), {
    status: 200,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" },
  });
}
