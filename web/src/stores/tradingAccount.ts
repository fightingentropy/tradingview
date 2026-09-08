import { createMemo, createRoot, createSignal } from "solid-js";
import type { Id } from "../../convex/_generated/dataModel";
import { vaultsList } from "./vaults";

type TradingAccountType = "user" | "vault";

const {
  tradingAccountType,
  tradingVaultId,
  tradingVault,
  tradingAccountLabel,
  setTradingAccountToUser,
  setTradingAccountToVault,
} = createRoot(() => {
  const [tradingAccountType, setTradingAccountType] =
    createSignal<TradingAccountType>("user");
  const [tradingVaultId, setTradingVaultId] = createSignal<Id<"vaults"> | null>(
    null,
  );

  const setTradingAccountToUser = () => {
    setTradingAccountType("user");
    setTradingVaultId(null);
  };

  const setTradingAccountToVault = (vaultId: Id<"vaults">) => {
    setTradingAccountType("vault");
    setTradingVaultId(vaultId);
  };

  const tradingVault = createMemo(() => {
    const vaultId = tradingVaultId();
    if (!vaultId) return null;
    return vaultsList().find((vault) => vault._id === vaultId) ?? null;
  });

  const tradingAccountLabel = createMemo(() => {
    if (tradingAccountType() !== "vault") return "Personal";
    return tradingVault()?.name ?? "My Vault";
  });

  return {
    tradingAccountType,
    tradingVaultId,
    tradingVault,
    tradingAccountLabel,
    setTradingAccountToUser,
    setTradingAccountToVault,
  };
});

const isVaultTradingAccount = () =>
  tradingAccountType() === "vault" && !!tradingVaultId();

export {
  tradingAccountType,
  tradingVaultId,
  tradingVault,
  tradingAccountLabel,
  setTradingAccountToUser,
  setTradingAccountToVault,
  isVaultTradingAccount,
};
