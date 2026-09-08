import { type Component, createEffect, onCleanup, onMount } from "solid-js";

type TurnstileApi = {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      action: string;
      theme: "dark";
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
      "response-field": boolean;
      "refresh-expired": "auto";
    },
  ) => string;
  remove: (widgetId: string) => void;
  reset: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_ID = "cloudflare-turnstile-script";
const SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export const TurnstileWidget: Component<{
  siteKey: string;
  resetKey: number;
  onToken: (token: string | null) => void;
}> = (props) => {
  let container: HTMLDivElement | undefined;
  let widgetId: string | undefined;
  let disposed = false;

  const render = () => {
    if (disposed || !container || !window.turnstile || widgetId) return;
    widgetId = window.turnstile.render(container, {
      sitekey: props.siteKey,
      action: "signup",
      theme: "dark",
      callback: (token) => props.onToken(token),
      "expired-callback": () => props.onToken(null),
      "error-callback": () => {
        props.onToken(null);
      },
      "response-field": false,
      "refresh-expired": "auto",
    });
  };

  createEffect(() => {
    void props.resetKey;
    if (widgetId && window.turnstile) {
      props.onToken(null);
      window.turnstile.reset(widgetId);
    }
  });

  onMount(() => {
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    const script = existing ?? document.createElement("script");
    const onLoad = () => render();
    script.addEventListener("load", onLoad);
    if (!existing) {
      script.id = SCRIPT_ID;
      script.src = SCRIPT_URL;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    } else {
      render();
    }

    onCleanup(() => {
      disposed = true;
      script.removeEventListener("load", onLoad);
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
      widgetId = undefined;
      props.onToken(null);
    });
  });

  return <div ref={container} class="min-h-[65px]" aria-label="Bot verification" />;
};
