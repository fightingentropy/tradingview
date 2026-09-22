import type { ConvexClient, ConvexHttpClient } from "convex/browser";
import type { FunctionReference } from "convex/server";
import { createEffect, createSignal, onCleanup } from "solid-js";

const convexUrl = import.meta.env.VITE_CONVEX_URL;
if (!convexUrl) {
  throw new Error("VITE_CONVEX_URL is not set.");
}

let client: ConvexClient | undefined;
let clientPromise: Promise<ConvexClient> | undefined;
let publicClientPromise: Promise<ConvexHttpClient> | undefined;
let auth: Parameters<ConvexClient["setAuth"]> | undefined;

const getClient = () => clientPromise ??= import("convex/browser").then(({ ConvexClient }) => {
  client = new ConvexClient(convexUrl);
  if (auth) client.setAuth(...auth);
  return client;
}).catch(error => { clientPromise = undefined; throw error; });

// Registering the token provider must not open a socket on public pages.
export const convex = {
  setAuth(...args: Parameters<ConvexClient["setAuth"]>) {
    auth = args;
    client?.setAuth(...args);
  },
  mutation: ((...args: Parameters<ConvexClient["mutation"]>) => getClient().then(c => c.mutation(...args))) as ConvexClient["mutation"],
  action: ((...args: Parameters<ConvexClient["action"]>) => getClient().then(c => c.action(...args))) as ConvexClient["action"],
};

// Auth refresh uses a separate HTTP client to avoid recursing through setAuth.
export const convexPublic = {
  action: ((...args: Parameters<ConvexHttpClient["action"]>) => {
    publicClientPromise ??= import("convex/browser").then(({ ConvexHttpClient }) => new ConvexHttpClient(convexUrl))
      .catch(error => { publicClientPromise = undefined; throw error; });
    return publicClientPromise.then(c => c.action(args[0], args[1]));
  }) as ConvexHttpClient["action"],
};

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
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    const fail = (error: unknown) => {
      if (disposed) return;
      console.error("Convex query error:", error);
      setData(() => initial as TResult | undefined);
    };
    setData(() => initial as TResult | undefined);
    void getClient().then(client => {
      if (disposed) return;
      const subscription = client.onUpdate(query, resolvedArgs, (value: TResult) => {
        if (!disposed) setData(() => value);
      }, fail);
      unsubscribe = subscription;
      const current = subscription.getCurrentValue();
      if (current !== undefined) setData(() => current);
    }).catch(fail);
    onCleanup(() => { disposed = true; unsubscribe?.(); });
  });

  return data;
};
