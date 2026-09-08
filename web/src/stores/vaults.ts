import { createMemo, createRoot, createSignal } from "solid-js";
import type { Id } from "../../convex/_generated/dataModel";
import { api } from "../../convex/_generated/api";
import { convex, createConvexQuery } from "../lib/convex";
import { isAuthenticated } from "./auth";

export type VaultStatus = "active" | "paused" | "closed";

export type VaultSummary = {
  _id: Id<"vaults">;
  name: string;
  operatorUserId: Id<"users">;
  totalShares: number;
  status: VaultStatus;
  createdAt: number;
  equityUSDC: number;
  pnl: number;
  sharePrice: number;
  memberShares: number;
  memberCostBasisUSDC: number;
  isOperator: boolean;
};

export type VaultDetail = VaultSummary & {
  memberValueUSDC: number;
  memberProfitUSDC: number;
  metricsUpdatedAt: number | null;
};

const listVaultsRef = api.vaults.listVaults;
const vaultDetailRef = api.vaults.getVaultDetail;
const createVaultRef = api.vaults.createVault;
const depositRef = api.vaults.depositUSDC;
const withdrawRef = api.vaults.withdrawUSDC;

const {
  vaultsList,
  vaultDetail,
  activeVaultId,
  setActiveVaultId,
  vaultsTotalEquity,
} = createRoot(() => {
  const [activeVaultId, setActiveVaultId] = createSignal<Id<"vaults"> | null>(
    null,
  );

  const listQuery = createConvexQuery(listVaultsRef, () => ({}), []);
  const detailQuery = createConvexQuery(
    vaultDetailRef,
    () => {
      const vaultId = activeVaultId();
      return vaultId ? { vaultId } : null;
    },
    null,
  );

  const vaultsList = () => listQuery() ?? [];
  const vaultDetail = () => detailQuery() ?? null;

  const vaultsTotalEquity = createMemo(() => {
    if (!isAuthenticated()) return 0;
    return vaultsList().reduce(
      (sum, vault) => sum + vault.memberShares * vault.sharePrice,
      0,
    );
  });

  return {
    vaultsList,
    vaultDetail,
    activeVaultId,
    setActiveVaultId,
    vaultsTotalEquity,
  };
});

export {
  vaultsList,
  vaultDetail,
  activeVaultId,
  setActiveVaultId,
  vaultsTotalEquity,
};

export const createVault = async ({
  name,
}: {
  name: string;
}): Promise<{ ok: boolean; error?: string; vaultId?: Id<"vaults"> }> => {
  if (!isAuthenticated()) {
    return { ok: false, error: "Sign in to create a vault." };
  }
  const trimmed = name.trim();
  if (!trimmed) {
    return { ok: false, error: "Enter a vault name." };
  }
  try {
    const result = await convex.mutation(createVaultRef, { name: trimmed });
    return { ok: true, vaultId: result.vaultId };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create vault.";
    console.error("Failed to create vault:", error);
    return { ok: false, error: message };
  }
};

export const depositVault = async ({
  vaultId,
  amount,
}: {
  vaultId: Id<"vaults">;
  amount: number;
}): Promise<{ ok: boolean; error?: string }> => {
  if (!isAuthenticated()) {
    return { ok: false, error: "Sign in to deposit." };
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "Enter a valid amount." };
  }
  try {
    await convex.mutation(depositRef, {
      vaultId,
      amount,
      idempotencyKey: crypto.randomUUID().replaceAll("-", ""),
    });
    return { ok: true };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Deposit failed.";
    console.error("Failed to deposit:", error);
    return { ok: false, error: message };
  }
};

export const withdrawVault = async ({
  vaultId,
  shares,
}: {
  vaultId: Id<"vaults">;
  shares: number;
}): Promise<{ ok: boolean; error?: string }> => {
  if (!isAuthenticated()) {
    return { ok: false, error: "Sign in to withdraw." };
  }
  if (!Number.isFinite(shares) || shares <= 0) {
    return { ok: false, error: "Enter a valid share amount." };
  }
  try {
    await convex.mutation(withdrawRef, {
      vaultId,
      shares,
      idempotencyKey: crypto.randomUUID().replaceAll("-", ""),
    });
    return { ok: true };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Withdrawal failed.";
    console.error("Failed to withdraw:", error);
    return { ok: false, error: message };
  }
};
