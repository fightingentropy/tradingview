import { OrderRejectedError, type OrderResult, type TriggerLeg, type placeOrder, type placeBracket, type updateLeverage } from '@/lib/hyperliquid/exchange';
import type { HlActiveAsset, HlOrderBook } from '@/lib/hyperliquid/info';
import { priceToWire } from '@/lib/hyperliquid/sign';
import { materiallyDifferentMid } from '@/lib/tradePreflight';
import { TradePreflightError, TradeSubmissionUnknownError, adverseEntryBound, errorMessage, lotQuantized, triggerLegIsValid, type PositionDraft, type TradeDraft, type TradeSubmission } from '@/lib/tradeTicketModel';

export interface TradeExecutionServices {
  assertCurrent: () => void;
  readPosition: () => Promise<PositionDraft | null>;
  readBook: () => Promise<HlOrderBook>;
  readActive: () => Promise<HlActiveAsset | undefined>;
  placeOrder: typeof placeOrder;
  placeBracket: typeof placeBracket;
  updateLeverage: typeof updateLeverage;
}

/** One fresh validation per signed action; no account refresh delays the receipt. */
export async function submitTradeDraft(draft: TradeDraft, services: TradeExecutionServices): Promise<TradeSubmission> {
  let leveragePostAttempted = false;
  let leveragePostSucceeded = false;
  let orderPostAttempted = false;

  const makeSubmission = (
    results: OrderResult[],
    legTypes: TriggerLeg['tpsl'][],
  ): TradeSubmission => ({
    results,
    legTypes,
    coin: draft.coin,
    network: draft.network,
    connectionAddress: draft.connectionAddress,
    requestedSize: draft.size,
    szDecimals: draft.szDecimals,
    action: draft.action,
    orderType: draft.orderType,
    limitPrice: draft.limitPrice == null ? undefined : Number(priceToWire(draft.limitPrice, draft.szDecimals)),
    fullClose: draft.fullClose,
    reduceOnly: draft.reduceOnly,
  });

  const assertContextStillMatches = services.assertCurrent;

  const validateDraftState = async (expectPostUpdateSettings: boolean) => {
    assertContextStillMatches();

    // Fresh, independent reads run together after identity verification. The
    // selected market's position is enough here; spot/vault/history reads do not
    // affect the approved order and must not delay submission.
    const [latestBook, latestPosition, freshActive] = await Promise.all([
      draft.orderType === 'market' ? services.readBook() : Promise.resolve(null),
      services.readPosition(),
      draft.reduceOnly ? Promise.resolve(undefined) : services.readActive(),
    ]);
    const expectedPosition = draft.expectedPosition;
    const positionPresenceChanged = !!latestPosition !== !!expectedPosition;
    const positionDetailsChanged =
      !!latestPosition &&
      !!expectedPosition &&
      (latestPosition.side !== expectedPosition.side ||
        lotQuantized(latestPosition.size, draft.szDecimals) !==
          lotQuantized(expectedPosition.size, draft.szDecimals));
    if (positionPresenceChanged || positionDetailsChanged) {
      throw new TradePreflightError('Your position changed. Check the size and try again.');
    }

    if (draft.reduceOnly) {
      const reducesLatest =
        !!latestPosition &&
        ((latestPosition.side === 'long' && draft.side === 'sell') ||
          (latestPosition.side === 'short' && draft.side === 'buy'));
      const latestSize = lotQuantized(latestPosition?.size ?? 0, draft.szDecimals);
      const orderSize = lotQuantized(draft.size, draft.szDecimals);
      if (!reducesLatest || orderSize > latestSize) {
        throw new TradePreflightError('The position changed. Check how much you want to close.');
      }
      // A Close action must still flatten the exact live lot-quantized size.
      if (draft.fullClose && orderSize !== latestSize) {
        throw new TradePreflightError('The position size changed. Reopen Close from Account.');
      }
    }

    if (!draft.reduceOnly) {
      if (expectPostUpdateSettings) {
        if (!freshActive) {
          throw new TradePreflightError(
            'Couldn’t verify your leverage settings. Try again.',
          );
        }
        if (
          freshActive.leverage !== draft.leverage ||
          freshActive.isCross !== draft.isCross
        ) {
          throw new TradePreflightError(
            'Your leverage settings are still updating. Try again shortly.',
          );
        }
      } else if (draft.expectedActive) {
        if (!freshActive) {
          throw new TradePreflightError('Couldn’t refresh your leverage settings. Try again.');
        }
        if (
          freshActive.leverage !== draft.expectedActive.leverage ||
          freshActive.isCross !== draft.expectedActive.isCross
        ) {
          throw new TradePreflightError('Your leverage settings changed. Check them and try again.');
        }
      } else if (
        freshActive &&
        (freshActive.leverage !== draft.leverage || freshActive.isCross !== draft.isCross)
      ) {
        throw new TradePreflightError(
          'Your leverage settings changed. Check them and try again.',
        );
      }

      if (draft.triggers.length > 0) {
        const freshTriggerMarkPx = freshActive?.markPx;
        if (!freshTriggerMarkPx || freshTriggerMarkPx <= 0) {
          throw new TradePreflightError('Couldn’t check your take-profit or stop-loss price.');
        }
        const reviewedTriggersValid = draft.triggers.every((leg) =>
          triggerLegIsValid(
            leg,
            draft.side,
            draft.riskEntryPx,
            draft.triggerMarkPx,
            draft.slippage,
          ),
        );
        const freshTriggersValid = draft.triggers.every((leg) =>
          triggerLegIsValid(
            leg,
            draft.side,
            draft.riskEntryPx,
            freshTriggerMarkPx,
            draft.slippage,
          ),
        );
        if (!reviewedTriggersValid || freshTriggersValid !== reviewedTriggersValid) {
          throw new TradePreflightError('The price moved. Check your take-profit and stop-loss prices.');
        }
      }
    }

    if (draft.orderType === 'market') {
      const latestBid = latestBook?.bids[0]?.price;
      const latestAsk = latestBook?.asks[0]?.price;
      if (!(latestBid && latestBid > 0 && latestAsk && latestAsk > 0)) {
        throw new TradePreflightError('Couldn’t get a current price. Try again.');
      }
      const freshMid = (latestBid + latestAsk) / 2;
      if (materiallyDifferentMid(draft.executionMidPx, freshMid, draft.slippage)) {
        throw new TradePreflightError('The price moved. Check the updated price and try again.');
      }
      const reviewedHardCap = adverseEntryBound(
        draft.executionMidPx,
        draft.side === 'buy',
        draft.slippage,
      );
      if (Math.abs(reviewedHardCap - draft.hardIocPx) > Math.max(1e-10, reviewedHardCap * 1e-12)) {
        throw new TradePreflightError('The price limit changed. Reopen the order and try again.');
      }
    }

    // Network/market/account may change while the three fresh reads are in flight.
    assertContextStillMatches();
  };

  try {
    // The exchange wrapper runs this validation immediately before signing.
    // An additional early pass repeats the same network work without making
    // the final signed snapshot any fresher.
    assertContextStillMatches();

    if (draft.needsLeverageUpdate) {
      await services.updateLeverage({
        network: draft.network,
        recoveryCoin: draft.coin,
        identity: draft.identity,
        validateImmediatelyBeforeSigning: () => validateDraftState(false),
        assertIdentityCurrent: assertContextStillMatches,
        assetIndex: draft.assetIndex,
        isCross: draft.isCross,
        leverage: draft.leverage,
        onPostAttempt: () => {
          leveragePostAttempted = true;
        },
      });
      leveragePostSucceeded = true;
      // The settings POST yielded control; do not continue into an order if the
      // user changed account/network/market while it was in flight.
      assertContextStillMatches();
    }

    const legs: TriggerLeg[] = draft.triggers.map((leg) => ({ ...leg }));
    if (legs.length > 0) {
      const results = await services.placeBracket({
        network: draft.network,
        recoveryCoin: draft.coin,
        identity: draft.identity,
        validateImmediatelyBeforeSigning: () =>
          validateDraftState(draft.needsLeverageUpdate),
        assertIdentityCurrent: assertContextStillMatches,
        assetIndex: draft.assetIndex,
        szDecimals: draft.szDecimals,
        isBuy: draft.side === 'buy',
        size: draft.size,
        limitPrice: draft.orderType === 'limit' ? draft.limitPrice : undefined,
        postOnly: draft.orderType === 'limit' && draft.postOnly,
        markPx: draft.executionMidPx,
        slippage: draft.slippage,
        legs,
        onPostAttempt: () => {
          orderPostAttempted = true;
        },
      });
      if (!results[0]) throw new Error('Hyperliquid returned no parent order status');
      return makeSubmission(results, legs.map((leg) => leg.tpsl));
    }

    const result = await services.placeOrder({
      network: draft.network,
      recoveryCoin: draft.coin,
      identity: draft.identity,
      validateImmediatelyBeforeSigning: () =>
        validateDraftState(draft.needsLeverageUpdate),
      assertIdentityCurrent: assertContextStillMatches,
      assetIndex: draft.assetIndex,
      szDecimals: draft.szDecimals,
      isBuy: draft.side === 'buy',
      size: draft.size,
      reduceOnly: draft.reduceOnly,
      limitPrice: draft.orderType === 'limit' ? draft.limitPrice : undefined,
      marketIocPrice: draft.orderType === 'market' ? draft.hardIocPx : undefined,
      postOnly: draft.orderType === 'limit' && draft.postOnly,
      markPx: draft.executionMidPx,
      slippage: draft.slippage,
      onPostAttempt: () => {
        orderPostAttempted = true;
      },
    });
    return makeSubmission([result], []);
  } catch (error) {
    if (error instanceof OrderRejectedError) throw error;
    if (leveragePostAttempted || orderPostAttempted) {
      throw new TradeSubmissionUnknownError(
        errorMessage(error),
        leveragePostAttempted,
        leveragePostSucceeded,
        orderPostAttempted,
      );
    }
    if (error instanceof TradePreflightError) throw error;
    throw new TradePreflightError(errorMessage(error));
  }
}
