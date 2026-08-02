/**
 * The credit shapes, with no data access attached.
 *
 * Split out of credits.ts on purpose: that module reaches for a Supabase
 * client, and both the client components (the balance hook, the paywall) and
 * the server routes need these types. Keeping them here means a client bundle
 * never pulls server data-access code in behind a type import.
 *
 * A credit is a credit. There used to be two kinds — a `match` credit unlocked
 * the CV alone, a `full` credit added the interview report — which is why the
 * balance carried a per-tier breakdown, the tier of the next FIFO spend, and
 * the price of lifting an order to Full. One product means one number.
 */

export type CreditOrder = {
  id: string;
  sku: string;
  creditsTotal: number;
  creditsUsed: number;
  creditsLeft: number;
  createdAt: string;
};

export type CreditBalance = {
  /** Credits left across every paid order. */
  total: number;
  orders: CreditOrder[];
};

export const EMPTY_BALANCE: CreditBalance = {
  total: 0,
  orders: [],
};
