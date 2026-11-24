export const GRADE_REQUEST_URL =
  "https://github.com/robd-hub/agent-report-card/issues/new?template=grade-request.yml";
/** A "Reply to a grade" issue with the agent filled in (.github/ISSUE_TEMPLATE/builder-reply.yml). */
export const builderReplyUrl = (agentId: string) =>
  `https://github.com/robd-hub/agent-report-card/issues/new?template=builder-reply.yml&agent-id=${encodeURIComponent(agentId)}`;
export const X_URL = "https://x.com/agentreportcard";
export const STATUS_URL = "https://stats.uptimerobot.com/qX2nWP1BOo";
/** Our MCP server's listing on mcprush (the link its badge uses). */
export const MCPRUSH_URL = "https://mcprush.com/to/agent-report-card-mcp?ref=badge";

/** Grades are paid in USDC on Base. PAY_ADDRESS is Rob's public Base wallet address. */
export const PAY_ADDRESS = "0x57dE743368Ef3cf200ea6295Ab4981C8784a1054";
export const PAY_URL = `https://basescan.org/address/${PAY_ADDRESS}`;
export const GRADE_PRICE_USD = 10;
export const REGRADE_PRICE_USD = 5;

/** Stripe Payment Links (set at build time); empty until card payments are switched on. */
export const CARD_LINK = process.env.NEXT_PUBLIC_CARD_LINK || "";
export const CARD_LINK_REGRADE = process.env.NEXT_PUBLIC_CARD_LINK_REGRADE || "";
