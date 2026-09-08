import { ConvexClient, ConvexHttpClient } from "convex/browser";
import type { FunctionReference } from "convex/server";
import { createEffect, createSignal, onCleanup } from "solid-js";

const convexUrl = import.meta.env.VITE_CONVEX_URL;
if (!convexUrl) {
  throw new Error("VITE_CONVEX_URL is not set.");
}

export const convex = new ConvexClient(convexUrl);
// Authentication bootstrap/refresh actions intentionally use a separate
// unauthenticated HTTP client so refreshing an expired token cannot recurse
// through ConvexClient's async auth-token provider.
export const convexPublic = new ConvexHttpClient(convexUrl);

export const createConvexQuery = <TArgs extends Record<string, any>, TResult>(
  query: FunctionReference<"query", "public", TArgs, TResult>,
  args: () => TArgs | null,
  initial?: TResult,
) => {
  const [data, setData] = createSignal<TResult | undefined>(
    initial as TResult | undefined,
  );

  createEffect(() => {
    const resolvedArgs = args();
    if (!resolvedArgs) {
      setData(() => initial as TResult | undefined);
      return;
    }
    const subscription = convex.onUpdate(
      query,
      resolvedArgs,
      (value: TResult) => {
        setData(() => value);
      },
      (error) => {
        console.error("Convex query error:", error);
        setData(() => initial as TResult | undefined);
      },
    );
    const current = subscription.getCurrentValue();
    if (current !== undefined) {
      setData(() => current);
    } else {
      setData(() => initial as TResult | undefined);
    }
    onCleanup(() => {
      subscription();
    });
  });

  return data;
};
