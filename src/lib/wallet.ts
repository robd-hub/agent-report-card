/**
 * Paying in USDC on Base straight from a browser wallet (MetaMask, Coinbase
 * Wallet, Rabby...), with no library: the wallet's own EIP-1193 provider
 * (window.ethereum) does the work. Used by the request form's wallet button.
 */
import { PAY_ADDRESS } from "./links";

export const BASE_CHAIN_ID = "0x2105"; // 8453
/** Circle's native USDC on Base (same as USDC_BASE in payment.ts; kept here so the browser bundle doesn't pull in node:fs). */
export const USDC_ON_BASE = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

export interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

/** The data for USDC's transfer(to, amount). USDC has 6 decimals. */
export function transferData(to: string, usd: number): string {
  const micro = BigInt(Math.round(usd * 1e6));
  return "0xa9059cbb" + to.toLowerCase().replace(/^0x/, "").padStart(64, "0") + micro.toString(16).padStart(64, "0");
}

export function browserWallet(): Eip1193 | null {
  if (typeof window === "undefined") return null;
  return ((window as unknown as { ethereum?: Eip1193 }).ethereum) ?? null;
}

/** Puts the wallet on Base, adding the network first if the wallet doesn't know it. */
async function useBase(wallet: Eip1193): Promise<void> {
  try {
    await wallet.request({ method: "wallet_switchEthereumChain", params: [{ chainId: BASE_CHAIN_ID }] });
  } catch (e) {
    if ((e as { code?: number }).code !== 4902) throw e;
    await wallet.request({
      method: "wallet_addEthereumChain",
      params: [{ chainId: BASE_CHAIN_ID, chainName: "Base", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: ["https://mainnet.base.org"], blockExplorerUrls: ["https://basescan.org"] }],
    });
  }
}

/**
 * Asks the wallet to send `usd` USDC on Base to our address, then waits until
 * the transaction is in a block. Returns the transaction hash.
 */
export async function payUsdc(wallet: Eip1193, usd: number, onStatus: (s: string) => void): Promise<string> {
  onStatus("Connecting to your wallet…");
  const accounts = (await wallet.request({ method: "eth_requestAccounts" })) as string[];
  if (!accounts?.[0]) throw new Error("No wallet account was shared.");
  onStatus("Switching your wallet to Base…");
  await useBase(wallet);
  onStatus(`Confirm the $${usd} USDC payment in your wallet…`);
  const hash = (await wallet.request({
    method: "eth_sendTransaction",
    params: [{ from: accounts[0], to: USDC_ON_BASE, data: transferData(PAY_ADDRESS, usd), value: "0x0" }],
  })) as string;
  onStatus("Payment sent. Waiting for Base to confirm it (a few seconds)…");
  for (let i = 0; i < 60; i++) {
    const receipt = (await wallet.request({ method: "eth_getTransactionReceipt", params: [hash] }).catch(() => null)) as { status?: string } | null;
    if (receipt?.status === "0x1") return hash;
    if (receipt?.status === "0x0") throw new Error("The payment failed on Base, so no USDC was sent.");
    await new Promise((r) => setTimeout(r, 2000));
  }
  return hash; // Still pending after two minutes: the server checks it again anyway.
}

/** A short, friendly message for a wallet error. */
export function walletError(e: unknown): string {
  const err = e as { code?: number; message?: string };
  if (err?.code === 4001) return "You cancelled in your wallet, so nothing was paid.";
  if (/insufficient|exceeds balance/i.test(err?.message ?? "")) return "Your wallet doesn't have enough USDC (or ETH for the network fee) on Base.";
  return err?.message ? `Your wallet said: ${err.message}` : "Something went wrong in your wallet.";
}
