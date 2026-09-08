import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { getAuthUser, requireAuthUser } from "./lib/auth";
import {
  getServerMarkPriceAtoms,
  normalizeAssetSymbol,
} from "./lib/prices";
import {
  ACCOUNTING_VERSION,
  CASH_PRECISION,
  PRICE_PRECISION,
  QUANTITY_PRECISION,
  ROUNDING_RULE,
  SHARE_PRECISION,
  AccountingInputError,
  atomsToDecimal,
  atomsToNumber,
  cashAtoms,
  issueVaultShares,
  mulDiv,
  notionalCashAtoms,
  readStoredAtoms,
  redeemVaultShares,
  shareAtoms,
} from "./lib/accounting";
import {
  readOperationReceipt,
  requestFingerprint,
  writeLedgerEvent,
  writeOperationReceipt,
} from "./lib/idempotency";

const OWNER_TYPE_VAULT = "vault" as const;
const OWNER_TYPE_USER = "user" as const;
const parseFinancial = <T>(operation: () => T): T => {
  try {
    return operation();
  } catch (error) {
    if (error instanceof AccountingInputError) {
      throw new ConvexError(error.message);
    }
    throw error;
  }
};

const getVaultMember = async (
  ctx: MutationCtx | QueryCtx,
  vaultId: Id<"vaults">,
  userId: Id<"users">,
) =>
  ctx.db
    .query("vaultMembers")
    .withIndex("by_vault_user", (q) =>
      q.eq("vaultId", vaultId).eq("userId", userId),
    )
    .unique();

const getVaultPerpsBalance = async (
  ctx: MutationCtx | QueryCtx,
  vaultId: Id<"vaults">,
  asset: "USDC" | "USDT",
) =>
  ctx.db
    .query("perpsBalances")
    .withIndex("by_owner_asset", (q) =>
      q
        .eq("ownerType", OWNER_TYPE_VAULT)
        .eq("ownerId", vaultId)
        .eq("asset", asset),
    )
    .unique();

const getUserPerpsBalance = async (
  ctx: MutationCtx | QueryCtx,
  userId: Id<"users">,
  asset: "USDC" | "USDT",
) =>
  ctx.db
    .query("perpsBalances")
    .withIndex("by_user_asset", (q) =>
      q.eq("userId", userId).eq("asset", asset),
    )
    .unique();

const calculateVaultEquityAtoms = async (
  ctx: MutationCtx | QueryCtx,
  vaultId: Id<"vaults">,
) => {
  const perpsBalances = await ctx.db
    .query("perpsBalances")
    .withIndex("by_owner", (q) =>
      q.eq("ownerType", OWNER_TYPE_VAULT).eq("ownerId", vaultId),
    )
    .collect();
  const spotBalances = await ctx.db
    .query("spotBalances")
    .withIndex("by_owner", (q) =>
      q.eq("ownerType", OWNER_TYPE_VAULT).eq("ownerId", vaultId),
    )
    .collect();
  const positions = await ctx.db
    .query("positions")
    .withIndex("by_owner", (q) =>
      q.eq("ownerType", OWNER_TYPE_VAULT).eq("ownerId", vaultId),
    )
    .collect();

  const perpsEquity = perpsBalances.reduce(
    (sum, balance) =>
      sum +
      readStoredAtoms(
        balance.balanceExact,
        balance.balance,
        CASH_PRECISION,
        false,
      ),
    0n,
  );

  let spotEquity = 0n;
  for (const balance of spotBalances) {
    const asset = normalizeAssetSymbol(balance.asset);
    const isCash = asset === "USDC" || asset === "USDT";
    const balanceAtoms = readStoredAtoms(
      balance.balanceExact,
      balance.balance,
      isCash ? CASH_PRECISION : QUANTITY_PRECISION,
      false,
    );
    if (balanceAtoms === 0n) continue;
    // Value spot at the authoritative server mark price (never a stale
    // client/demo-only path). Stablecoins resolve to 1 via the oracle.
    if (isCash) {
      spotEquity += balanceAtoms;
      continue;
    }
    const price = await getServerMarkPriceAtoms(ctx, balance.asset);
    spotEquity += notionalCashAtoms(balanceAtoms, price);
  }

  let unrealizedPnl = 0n;
  for (const position of positions) {
    const size = readStoredAtoms(
      position.sizeExact,
      position.size,
      QUANTITY_PRECISION,
    );
    if (size === 0n) continue;
    const entry = readStoredAtoms(
      position.entryPriceExact,
      position.entryPrice,
      PRICE_PRECISION,
      false,
    );
    const mark = await getServerMarkPriceAtoms(ctx, position.symbol);
    unrealizedPnl += notionalCashAtoms(size, mark - entry);
  }

  return perpsEquity + spotEquity + unrealizedPnl;
};

const calculateVaultEquity = async (
  ctx: MutationCtx | QueryCtx,
  vaultId: Id<"vaults">,
) =>
  atomsToNumber(
    await calculateVaultEquityAtoms(ctx, vaultId),
    CASH_PRECISION,
  );

const calculateVaultCostBasisAtoms = async (
  ctx: MutationCtx | QueryCtx,
  vaultId: Id<"vaults">,
) => {
  const members = await ctx.db
    .query("vaultMembers")
    .withIndex("by_vault", (q) => q.eq("vaultId", vaultId))
    .collect();
  return members.reduce(
    (sum, member) =>
      sum +
      readStoredAtoms(
        member.costBasisUSDCExact,
        member.costBasisUSDC,
        CASH_PRECISION,
        false,
      ),
    0n,
  );
};

const calculateVaultCostBasis = async (
  ctx: MutationCtx | QueryCtx,
  vaultId: Id<"vaults">,
) =>
  atomsToNumber(
    await calculateVaultCostBasisAtoms(ctx, vaultId),
    CASH_PRECISION,
  );

const upsertVaultMetrics = async (
  ctx: MutationCtx,
  vaultId: Id<"vaults">,
) => {
  const equityAtoms = await calculateVaultEquityAtoms(ctx, vaultId);
  const totalCostBasisAtoms = await calculateVaultCostBasisAtoms(ctx, vaultId);
  const pnlAtoms = equityAtoms - totalCostBasisAtoms;
  const equityUSDC = atomsToNumber(equityAtoms, CASH_PRECISION);
  const pnl = atomsToNumber(pnlAtoms, CASH_PRECISION);
  const updatedAt = Date.now();

  const existing = await ctx.db
    .query("vaultMetrics")
    .withIndex("by_vault", (q) => q.eq("vaultId", vaultId))
    .unique();

  if (existing) {
    await ctx.db.patch(existing._id, {
      equityUSDC,
      equityUSDCExact: atomsToDecimal(equityAtoms, CASH_PRECISION),
      pnl,
      pnlExact: atomsToDecimal(pnlAtoms, CASH_PRECISION),
      accountingVersion: ACCOUNTING_VERSION,
      cashPrecision: CASH_PRECISION,
      updatedAt,
    });
    return { equityUSDC, pnl, updatedAt };
  }

  await ctx.db.insert("vaultMetrics", {
    vaultId,
    equityUSDC,
    equityUSDCExact: atomsToDecimal(equityAtoms, CASH_PRECISION),
    pnl,
    pnlExact: atomsToDecimal(pnlAtoms, CASH_PRECISION),
    accountingVersion: ACCOUNTING_VERSION,
    cashPrecision: CASH_PRECISION,
    updatedAt,
  });
  return { equityUSDC, pnl, updatedAt };
};

const resolveSharePrice = (equityUSDC: number, totalShares: number) => {
  if (totalShares <= 0) return 1;
  return equityUSDC / totalShares;
};

const buildVaultSummary = (
  vault: Doc<"vaults">,
  metrics: Doc<"vaultMetrics"> | null,
  member: Doc<"vaultMembers"> | null,
  equityFallback: number | null,
  isOperator: boolean,
) => {
  const equityUSDC = metrics?.equityUSDC ?? equityFallback ?? 0;
  const pnl = metrics?.pnl ?? 0;
  const sharePrice = resolveSharePrice(equityUSDC, vault.totalShares);
  return {
    _id: vault._id,
    name: vault.name,
    operatorUserId: vault.operatorUserId,
    totalShares: vault.totalShares,
    status: vault.status,
    createdAt: vault.createdAt,
    equityUSDC,
    pnl,
    sharePrice,
    memberShares: member?.shares ?? 0,
    memberCostBasisUSDC: member?.costBasisUSDC ?? 0,
    isOperator,
  };
};

export const createVault = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);
    const name = args.name.trim();
    if (!name) {
      throw new ConvexError("Vault name is required.");
    }
    const now = Date.now();
    const vaultId = await ctx.db.insert("vaults", {
      name,
      operatorUserId: user._id,
      totalShares: 0,
      totalSharesExact: "0",
      accountingVersion: ACCOUNTING_VERSION,
      sharePrecision: SHARE_PRECISION,
      status: "active",
      createdAt: now,
    });
    await ctx.db.insert("vaultMetrics", {
      vaultId,
      equityUSDC: 0,
      equityUSDCExact: "0",
      pnl: 0,
      pnlExact: "0",
      accountingVersion: ACCOUNTING_VERSION,
      cashPrecision: CASH_PRECISION,
      updatedAt: now,
    });
    return { vaultId };
  },
});

export const listVaults = query({
  args: {},
  handler: async (ctx) => {
    const user = await getAuthUser(ctx);
    const [vaults, metrics] = await Promise.all([
      ctx.db.query("vaults").collect(),
      ctx.db.query("vaultMetrics").collect(),
    ]);
    const metricsByVault = new Map(
      metrics.map((metric) => [metric.vaultId, metric]),
    );

    const memberByVault = new Map<Id<"vaults">, Doc<"vaultMembers">>();
    if (user) {
      const members = await ctx.db
        .query("vaultMembers")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .collect();
      for (const member of members) {
        memberByVault.set(member.vaultId, member);
      }
    }

    return vaults.map((vault) =>
      buildVaultSummary(
        vault,
        metricsByVault.get(vault._id) ?? null,
        memberByVault.get(vault._id) ?? null,
        null,
        !!user && user._id === vault.operatorUserId,
      ),
    );
  },
});

export const getVaultDetail = query({
  args: { vaultId: v.id("vaults") },
  handler: async (ctx, args) => {
    const user = await getAuthUser(ctx);
    const vault = await ctx.db.get(args.vaultId);
    if (!vault) return null;

    const metrics = await ctx.db
      .query("vaultMetrics")
      .withIndex("by_vault", (q) => q.eq("vaultId", vault._id))
      .unique();

    const member = user ? await getVaultMember(ctx, vault._id, user._id) : null;

    let equityFallback: number | null = null;
    let pnlFallback: number | null = null;
    if (!metrics) {
      equityFallback = await calculateVaultEquity(ctx, vault._id);
      const totalCostBasis = await calculateVaultCostBasis(ctx, vault._id);
      pnlFallback = equityFallback - totalCostBasis;
    }

    const summary = buildVaultSummary(
      vault,
      metrics,
      member,
      equityFallback,
      !!user && user._id === vault.operatorUserId,
    );

    const sharePrice = summary.sharePrice;
    const memberValue = summary.memberShares * sharePrice;
    const memberProfit = Math.max(0, memberValue - summary.memberCostBasisUSDC);

    return {
      ...summary,
      pnl: metrics?.pnl ?? pnlFallback ?? summary.pnl,
      memberValueUSDC: memberValue,
      memberProfitUSDC: memberProfit,
      metricsUpdatedAt: metrics?.updatedAt ?? null,
    };
  },
});

export const depositUSDC = mutation({
  args: {
    vaultId: v.id("vaults"),
    amount: v.number(),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);
    const amount = parseFinancial(() => cashAtoms(args.amount));

    const vault = await ctx.db.get(args.vaultId);
    if (!vault) {
      throw new ConvexError("Vault not found.");
    }
    if (vault.status !== "active") {
      throw new ConvexError("Vault is not accepting deposits.");
    }

    const fingerprint = requestFingerprint({
      vaultId: String(vault._id),
      amount: atomsToDecimal(amount, CASH_PRECISION),
    });
    const receipt = await readOperationReceipt<{
      sharesMinted: number;
      sharePrice: number;
    }>(ctx, {
      ownerType: OWNER_TYPE_USER,
      ownerId: user._id,
      operation: "depositVaultUSDC",
      idempotencyKey: args.idempotencyKey,
      fingerprint,
    });
    if (receipt.result) return receipt.result;

    const equity = await calculateVaultEquityAtoms(ctx, vault._id);
    const totalShares = readStoredAtoms(
      vault.totalSharesExact,
      vault.totalShares,
      SHARE_PRECISION,
      false,
    );
    const mintedShares = parseFinancial(() =>
      issueVaultShares({ deposit: amount, equity, totalShares }),
    );
    const sharePrice =
      totalShares === 0n
        ? 1
        : atomsToNumber(equity, CASH_PRECISION) /
          atomsToNumber(totalShares, SHARE_PRECISION);
    const now = Date.now();

    const userBalance = await getUserPerpsBalance(ctx, user._id, "USDC");
    const userBalanceAmount = userBalance
      ? readStoredAtoms(
          userBalance.balanceExact,
          userBalance.balance,
          CASH_PRECISION,
          false,
        )
      : 0n;
    if (amount > userBalanceAmount) {
      throw new ConvexError("Insufficient USDC balance.");
    }

    if (userBalance) {
      await ctx.db.patch(userBalance._id, {
        ownerType: OWNER_TYPE_USER,
        ownerId: user._id,
        balance: atomsToNumber(userBalanceAmount - amount, CASH_PRECISION),
        balanceExact: atomsToDecimal(userBalanceAmount - amount, CASH_PRECISION),
        balancePrecision: CASH_PRECISION,
        accountingVersion: ACCOUNTING_VERSION,
        updatedAt: now,
      });
    } else {
      throw new ConvexError("Insufficient USDC balance.");
    }

    const vaultBalance = await getVaultPerpsBalance(ctx, vault._id, "USDC");
    const vaultBalanceAmount = vaultBalance
      ? readStoredAtoms(
          vaultBalance.balanceExact,
          vaultBalance.balance,
          CASH_PRECISION,
          false,
        )
      : 0n;
    if (vaultBalance) {
      await ctx.db.patch(vaultBalance._id, {
        ownerType: OWNER_TYPE_VAULT,
        ownerId: vault._id,
        balance: atomsToNumber(vaultBalanceAmount + amount, CASH_PRECISION),
        balanceExact: atomsToDecimal(vaultBalanceAmount + amount, CASH_PRECISION),
        balancePrecision: CASH_PRECISION,
        accountingVersion: ACCOUNTING_VERSION,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("perpsBalances", {
        ownerType: OWNER_TYPE_VAULT,
        ownerId: vault._id,
        asset: "USDC",
        balance: atomsToNumber(amount, CASH_PRECISION),
        balanceExact: atomsToDecimal(amount, CASH_PRECISION),
        balancePrecision: CASH_PRECISION,
        accountingVersion: ACCOUNTING_VERSION,
        updatedAt: now,
      });
    }

    const member = await getVaultMember(ctx, vault._id, user._id);
    if (member) {
      const memberShares = readStoredAtoms(
        member.sharesExact,
        member.shares,
        SHARE_PRECISION,
        false,
      );
      const memberCostBasis = readStoredAtoms(
        member.costBasisUSDCExact,
        member.costBasisUSDC,
        CASH_PRECISION,
        false,
      );
      await ctx.db.patch(member._id, {
        shares: atomsToNumber(memberShares + mintedShares, SHARE_PRECISION),
        sharesExact: atomsToDecimal(memberShares + mintedShares, SHARE_PRECISION),
        costBasisUSDC: atomsToNumber(memberCostBasis + amount, CASH_PRECISION),
        costBasisUSDCExact: atomsToDecimal(memberCostBasis + amount, CASH_PRECISION),
        accountingVersion: ACCOUNTING_VERSION,
        sharePrecision: SHARE_PRECISION,
        cashPrecision: CASH_PRECISION,
      });
    } else {
      await ctx.db.insert("vaultMembers", {
        vaultId: vault._id,
        userId: user._id,
        shares: atomsToNumber(mintedShares, SHARE_PRECISION),
        sharesExact: atomsToDecimal(mintedShares, SHARE_PRECISION),
        costBasisUSDC: atomsToNumber(amount, CASH_PRECISION),
        costBasisUSDCExact: atomsToDecimal(amount, CASH_PRECISION),
        accountingVersion: ACCOUNTING_VERSION,
        sharePrecision: SHARE_PRECISION,
        cashPrecision: CASH_PRECISION,
        createdAt: now,
      });
    }

    await ctx.db.patch(vault._id, {
      totalShares: atomsToNumber(totalShares + mintedShares, SHARE_PRECISION),
      totalSharesExact: atomsToDecimal(totalShares + mintedShares, SHARE_PRECISION),
      accountingVersion: ACCOUNTING_VERSION,
      sharePrecision: SHARE_PRECISION,
    });

    await upsertVaultMetrics(ctx, vault._id);

    await Promise.all([
      writeLedgerEvent(ctx, {
        ownerType: OWNER_TYPE_USER,
        ownerId: user._id,
        operation: "vault:deposit:debit",
        asset: "USDC",
        amountExact: atomsToDecimal(-amount, CASH_PRECISION),
        precision: CASH_PRECISION,
        accountingVersion: ACCOUNTING_VERSION,
        roundingRule: ROUNDING_RULE,
        referenceType: "vault",
        referenceId: String(vault._id),
        idempotencyKey: receipt.key,
      }),
      writeLedgerEvent(ctx, {
        ownerType: OWNER_TYPE_VAULT,
        ownerId: vault._id,
        operation: "vault:deposit:credit",
        asset: "USDC",
        amountExact: atomsToDecimal(amount, CASH_PRECISION),
        precision: CASH_PRECISION,
        accountingVersion: ACCOUNTING_VERSION,
        roundingRule: ROUNDING_RULE,
        referenceType: "user",
        referenceId: String(user._id),
        idempotencyKey: receipt.key,
      }),
    ]);
    const result = {
      sharesMinted: atomsToNumber(mintedShares, SHARE_PRECISION),
      sharePrice,
    };
    await writeOperationReceipt(ctx, {
      ownerType: OWNER_TYPE_USER,
      ownerId: user._id,
      operation: "depositVaultUSDC",
      idempotencyKey: receipt.key,
      fingerprint,
      result,
    });
    return result;
  },
});

export const withdrawUSDC = mutation({
  args: {
    vaultId: v.id("vaults"),
    shares: v.number(),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);
    const shares = parseFinancial(() => shareAtoms(args.shares));

    const vault = await ctx.db.get(args.vaultId);
    if (!vault) {
      throw new ConvexError("Vault not found.");
    }

    const member = await getVaultMember(ctx, vault._id, user._id);
    if (!member) {
      throw new ConvexError("No shares available to withdraw.");
    }

    const fingerprint = requestFingerprint({
      vaultId: String(vault._id),
      shares: atomsToDecimal(shares, SHARE_PRECISION),
    });
    const receipt = await readOperationReceipt<{
      payout: number;
      fee: number;
      sharePrice: number;
    }>(ctx, {
      ownerType: OWNER_TYPE_USER,
      ownerId: user._id,
      operation: "withdrawVaultUSDC",
      idempotencyKey: args.idempotencyKey,
      fingerprint,
    });
    if (receipt.result) return receipt.result;

    const memberShares = readStoredAtoms(
      member.sharesExact,
      member.shares,
      SHARE_PRECISION,
      false,
    );
    const totalShares = readStoredAtoms(
      vault.totalSharesExact,
      vault.totalShares,
      SHARE_PRECISION,
      false,
    );
    const memberCostBasis = readStoredAtoms(
      member.costBasisUSDCExact,
      member.costBasisUSDC,
      CASH_PRECISION,
      false,
    );
    const equity = await calculateVaultEquityAtoms(ctx, vault._id);
    const redemption = parseFinancial(() =>
      redeemVaultShares({
        shares,
        memberShares,
        totalShares,
        equity,
        memberCostBasis,
      }),
    );
    const sharePrice =
      atomsToNumber(equity, CASH_PRECISION) /
      atomsToNumber(totalShares, SHARE_PRECISION);

    const now = Date.now();

    // Share price reflects BLENDED equity (perps USDC + spot valued at the
    // server mark price), but payout is USDC-only. If the vault holds non-USDC
    // spot, liquidate the withdrawing member's PRO-RATA fraction of each spot
    // asset to USDC at the server mark price BEFORE paying out, so the USDC
    // payout matches the member's fair blended share value and later members
    // are not drained. The fraction is the member's share of the whole vault.
    if (shares > 0n) {
      const vaultSpotBalances = await ctx.db
        .query("spotBalances")
        .withIndex("by_owner", (q) =>
          q.eq("ownerType", OWNER_TYPE_VAULT).eq("ownerId", vault._id),
        )
        .collect();

      let usdcFromSpot = 0n;
      for (const spot of vaultSpotBalances) {
        const asset = normalizeAssetSymbol(spot.asset);
        if (asset === "USDC") continue;
        const isCash = asset === "USDT";
        const precision = isCash ? CASH_PRECISION : QUANTITY_PRECISION;
        const spotBalance = readStoredAtoms(
          spot.balanceExact,
          spot.balance,
          precision,
          false,
        );
        if (spotBalance <= 0n) continue;
        const sellSize = mulDiv(spotBalance, shares, totalShares);
        if (sellSize <= 0n) continue;
        usdcFromSpot += isCash
          ? sellSize
          : notionalCashAtoms(
              sellSize,
              await getServerMarkPriceAtoms(ctx, spot.asset),
            );
        await ctx.db.patch(spot._id, {
          balance: atomsToNumber(spotBalance - sellSize, precision),
          balanceExact: atomsToDecimal(spotBalance - sellSize, precision),
          balancePrecision: precision,
          accountingVersion: ACCOUNTING_VERSION,
          updatedAt: now,
        });
      }

      if (usdcFromSpot > 0n) {
        const vaultUsdcBalance = await getVaultPerpsBalance(
          ctx,
          vault._id,
          "USDC",
        );
        const existingVaultUsdc = vaultUsdcBalance
          ? readStoredAtoms(
              vaultUsdcBalance.balanceExact,
              vaultUsdcBalance.balance,
              CASH_PRECISION,
              false,
            )
          : 0n;
        if (vaultUsdcBalance) {
          await ctx.db.patch(vaultUsdcBalance._id, {
            ownerType: OWNER_TYPE_VAULT,
            ownerId: vault._id,
            balance: atomsToNumber(existingVaultUsdc + usdcFromSpot, CASH_PRECISION),
            balanceExact: atomsToDecimal(existingVaultUsdc + usdcFromSpot, CASH_PRECISION),
            balancePrecision: CASH_PRECISION,
            accountingVersion: ACCOUNTING_VERSION,
            updatedAt: now,
          });
        } else {
          await ctx.db.insert("perpsBalances", {
            ownerType: OWNER_TYPE_VAULT,
            ownerId: vault._id,
            asset: "USDC",
            balance: atomsToNumber(usdcFromSpot, CASH_PRECISION),
            balanceExact: atomsToDecimal(usdcFromSpot, CASH_PRECISION),
            balancePrecision: CASH_PRECISION,
            accountingVersion: ACCOUNTING_VERSION,
            updatedAt: now,
          });
        }
      }
    }

    const vaultBalance = await getVaultPerpsBalance(ctx, vault._id, "USDC");
    const vaultUsdc = vaultBalance
      ? readStoredAtoms(
          vaultBalance.balanceExact,
          vaultBalance.balance,
          CASH_PRECISION,
          false,
        )
      : 0n;
    if (redemption.value > vaultUsdc) {
      throw new ConvexError("Vault has insufficient USDC liquidity.");
    }

    if (vaultBalance) {
      await ctx.db.patch(vaultBalance._id, {
        ownerType: OWNER_TYPE_VAULT,
        ownerId: vault._id,
        balance: atomsToNumber(vaultUsdc - redemption.value, CASH_PRECISION),
        balanceExact: atomsToDecimal(vaultUsdc - redemption.value, CASH_PRECISION),
        balancePrecision: CASH_PRECISION,
        accountingVersion: ACCOUNTING_VERSION,
        updatedAt: now,
      });
    }

    const userBalance = await getUserPerpsBalance(ctx, user._id, "USDC");
    const userBalanceAmount = userBalance
      ? readStoredAtoms(
          userBalance.balanceExact,
          userBalance.balance,
          CASH_PRECISION,
          false,
        )
      : 0n;
    if (userBalance) {
      await ctx.db.patch(userBalance._id, {
        ownerType: OWNER_TYPE_USER,
        ownerId: user._id,
        balance: atomsToNumber(userBalanceAmount + redemption.payout, CASH_PRECISION),
        balanceExact: atomsToDecimal(userBalanceAmount + redemption.payout, CASH_PRECISION),
        balancePrecision: CASH_PRECISION,
        accountingVersion: ACCOUNTING_VERSION,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("perpsBalances", {
        userId: user._id,
        ownerType: OWNER_TYPE_USER,
        ownerId: user._id,
        asset: "USDC",
        balance: atomsToNumber(redemption.payout, CASH_PRECISION),
        balanceExact: atomsToDecimal(redemption.payout, CASH_PRECISION),
        balancePrecision: CASH_PRECISION,
        accountingVersion: ACCOUNTING_VERSION,
        updatedAt: now,
      });
    }

    if (redemption.fee > 0n) {
      const operatorBalance = await getUserPerpsBalance(
        ctx,
        vault.operatorUserId,
        "USDC",
      );
      const operatorBalanceAmount = operatorBalance
        ? readStoredAtoms(
            operatorBalance.balanceExact,
            operatorBalance.balance,
            CASH_PRECISION,
            false,
          )
        : 0n;
      if (operatorBalance) {
        await ctx.db.patch(operatorBalance._id, {
          ownerType: OWNER_TYPE_USER,
          ownerId: vault.operatorUserId,
          balance: atomsToNumber(operatorBalanceAmount + redemption.fee, CASH_PRECISION),
          balanceExact: atomsToDecimal(operatorBalanceAmount + redemption.fee, CASH_PRECISION),
          balancePrecision: CASH_PRECISION,
          accountingVersion: ACCOUNTING_VERSION,
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("perpsBalances", {
          userId: vault.operatorUserId,
          ownerType: OWNER_TYPE_USER,
          ownerId: vault.operatorUserId,
          asset: "USDC",
          balance: atomsToNumber(redemption.fee, CASH_PRECISION),
          balanceExact: atomsToDecimal(redemption.fee, CASH_PRECISION),
          balancePrecision: CASH_PRECISION,
          accountingVersion: ACCOUNTING_VERSION,
          updatedAt: now,
        });
      }

      await ctx.db.insert("vaultFees", {
        vaultId: vault._id,
        operatorUserId: vault.operatorUserId,
        amountUSDC: atomsToNumber(redemption.fee, CASH_PRECISION),
        amountUSDCExact: atomsToDecimal(redemption.fee, CASH_PRECISION),
        accountingVersion: ACCOUNTING_VERSION,
        cashPrecision: CASH_PRECISION,
        createdAt: now,
      });
    }

    await ctx.db.patch(member._id, {
      shares: atomsToNumber(redemption.remainingShares, SHARE_PRECISION),
      sharesExact: atomsToDecimal(redemption.remainingShares, SHARE_PRECISION),
      costBasisUSDC: atomsToNumber(redemption.remainingCostBasis, CASH_PRECISION),
      costBasisUSDCExact: atomsToDecimal(redemption.remainingCostBasis, CASH_PRECISION),
      accountingVersion: ACCOUNTING_VERSION,
      sharePrecision: SHARE_PRECISION,
      cashPrecision: CASH_PRECISION,
    });

    await ctx.db.patch(vault._id, {
      totalShares: atomsToNumber(totalShares - shares, SHARE_PRECISION),
      totalSharesExact: atomsToDecimal(totalShares - shares, SHARE_PRECISION),
      accountingVersion: ACCOUNTING_VERSION,
      sharePrecision: SHARE_PRECISION,
    });

    await upsertVaultMetrics(ctx, vault._id);

    await Promise.all([
      writeLedgerEvent(ctx, {
        ownerType: OWNER_TYPE_VAULT,
        ownerId: vault._id,
        operation: "vault:withdraw:debit",
        asset: "USDC",
        amountExact: atomsToDecimal(-redemption.value, CASH_PRECISION),
        precision: CASH_PRECISION,
        accountingVersion: ACCOUNTING_VERSION,
        roundingRule: ROUNDING_RULE,
        referenceType: "user",
        referenceId: String(user._id),
        idempotencyKey: receipt.key,
      }),
      writeLedgerEvent(ctx, {
        ownerType: OWNER_TYPE_USER,
        ownerId: user._id,
        operation: "vault:withdraw:payout",
        asset: "USDC",
        amountExact: atomsToDecimal(redemption.payout, CASH_PRECISION),
        precision: CASH_PRECISION,
        accountingVersion: ACCOUNTING_VERSION,
        roundingRule: ROUNDING_RULE,
        referenceType: "vault",
        referenceId: String(vault._id),
        idempotencyKey: receipt.key,
      }),
    ]);
    const result = {
      payout: atomsToNumber(redemption.payout, CASH_PRECISION),
      fee: atomsToNumber(redemption.fee, CASH_PRECISION),
      sharePrice,
    };
    await writeOperationReceipt(ctx, {
      ownerType: OWNER_TYPE_USER,
      ownerId: user._id,
      operation: "withdrawVaultUSDC",
      idempotencyKey: receipt.key,
      fingerprint,
      result,
    });
    return result;
  },
});
