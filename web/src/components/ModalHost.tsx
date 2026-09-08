import { type Component, Show, Suspense, lazy } from "solid-js";
import { authOpen } from "../stores/auth";
import { connectOpen } from "../stores/connect";
import { settingsOpen } from "../stores/settings";
import { transferModalOpen } from "../stores/wallet";

const AuthModal = lazy(() => import("./AuthModal"));
const ConnectModal = lazy(() => import("./ConnectModal"));
const SettingsModal = lazy(() => import("./SettingsModal"));
const TransferModal = lazy(() => import("./TransferModal"));

const ModalFallback: Component = () => (
  <div class="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4">
    <div
      role="status"
      class="rounded-lg border border-brand-border bg-brand-surface px-4 py-3 text-sm text-brand-slate-400"
    >
      Loading…
    </div>
  </div>
);

const ModalHost: Component = () => (
  <>
    <Show when={connectOpen()}>
      <Suspense fallback={<ModalFallback />}>
        <ConnectModal />
      </Suspense>
    </Show>
    <Show when={authOpen()}>
      <Suspense fallback={<ModalFallback />}>
        <AuthModal />
      </Suspense>
    </Show>
    <Show when={transferModalOpen()}>
      <Suspense fallback={<ModalFallback />}>
        <TransferModal />
      </Suspense>
    </Show>
    <Show when={settingsOpen()}>
      <Suspense fallback={<ModalFallback />}>
        <SettingsModal />
      </Suspense>
    </Show>
  </>
);

export default ModalHost;
