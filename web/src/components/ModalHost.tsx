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
  <div class="modal-backdrop">
    <div role="status" class="modal-loading">
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
