// Canonical payload contract for MLB Fair-Price WARN alerts.
// v1 is admin-only / log-only. Do NOT change without updating
// mem/logic/betting/mlb-fair-price-v1.md.

export interface FairPriceAlertPayload {
  message: string;
  parse_mode: "Markdown";
  admin_only: true;
  type: "mlb_fair_price";
}

export function buildFairPriceAdminPayload(message: string): FairPriceAlertPayload {
  return {
    message,
    parse_mode: "Markdown",
    admin_only: true,
    type: "mlb_fair_price",
  };
}