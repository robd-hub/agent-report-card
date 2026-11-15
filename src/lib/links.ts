export const GRADE_REQUEST_URL =
  "https://github.com/robd-hub/agent-report-card/issues/new?template=grade-request.yml";
export const X_URL = "https://x.com/agentreportcard";

/** Grades are paid in USDC on Base. PAY_ADDRESS is Rob's public Base wallet address. */
export const PAY_ADDRESS = "0x57dE743368Ef3cf200ea6295Ab4981C8784a1054";
export const PAY_URL = `https://basescan.org/address/${PAY_ADDRESS}`;
export const GRADE_PRICE_USD = 10;
export const REGRADE_PRICE_USD = 5;

/** Stripe Payment Links (set at build time); empty until card payments are switched on. */
export const CARD_LINK = process.env.NEXT_PUBLIC_CARD_LINK || "";
export const CARD_LINK_REGRADE = process.env.NEXT_PUBLIC_CARD_LINK_REGRADE || "";
