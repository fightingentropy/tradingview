import { Component, Show, createSignal } from "solid-js";
import { isAdmin, isAuthenticated, logout } from "../stores/auth";
import { currentPage, setCurrentPage } from "../stores/page";
import { vaultsList } from "../stores/vaults";
import type { VaultSummary } from "../stores/vaults";
import { openSettings, settingsOpen } from "../stores/settings";
import { prefetchPage } from "../lib/routeModules";
import AccountConnectionControl from "./AccountConnectionControl";

const Header: Component = () => {
  const [profileOpen, setProfileOpen] = createSignal(false);

  const handleMyVaultClick = () => {
    const operatorVault = vaultsList().find(
      (vault: VaultSummary) => vault.isOperator,
    );
    if (operatorVault) {
      setCurrentPage("vaults", { vaultId: operatorVault._id });
    } else {
      setCurrentPage("vaults");
    }
    setProfileOpen(false);
  };

  const toggleProfileMenu = () => {
    const next = !profileOpen();
    setProfileOpen(next);
  };

  const handleOpenSettings = () => {
    setProfileOpen(false);
    openSettings();
  };

  return (
    <header class="bg-brand-screen top-0 z-25 hidden items-center gap-2 px-3 py-2 sm:px-4 md:flex">
      <div class="flex items-center gap-6 pr-4 font-mono text-sm">
        <button
          onClick={() => setCurrentPage("trade")}
          class="flex items-center"
        >
          <span class="shrink-0 select-none text-base font-semibold tracking-tight text-brand-accent">Trading<span class="text-brand-slate-100">View</span></span>
        </button>
        <nav class="flex items-center gap-5">
          <button
            class={
              currentPage() === "trade"
                ? "text-brand-accent"
                : "text-brand-slate-400 hover:text-brand-slate-100"
            }
            onClick={() => setCurrentPage("trade")}
          >
            <p class="truncate">Trade</p>
          </button>
          <button
            class={
              currentPage() === "options"
                ? "text-brand-accent"
                : "text-brand-slate-400 hover:text-brand-slate-100"
            }
            onPointerEnter={() => prefetchPage("options")}
            onFocus={() => prefetchPage("options")}
            onClick={() => setCurrentPage("options")}
          >
            <p class="truncate">Options</p>
          </button>
          <button
            class={
              currentPage() === "portfolio"
                ? "text-brand-accent"
                : "text-brand-slate-400 hover:text-brand-slate-100"
            }
            onPointerEnter={() => prefetchPage("portfolio")}
            onFocus={() => prefetchPage("portfolio")}
            onClick={() => setCurrentPage("portfolio")}
          >
            <p class="truncate">Portfolio</p>
          </button>
          <button
            class={
              currentPage() === "vaults"
                ? "text-brand-accent"
                : "text-brand-slate-400 hover:text-brand-slate-100"
            }
            onPointerEnter={() => prefetchPage("vaults")}
            onFocus={() => prefetchPage("vaults")}
            onClick={() => setCurrentPage("vaults")}
          >
            <p class="truncate">Vaults</p>
          </button>
          <button
            class={
              currentPage() === "brief"
                ? "text-brand-accent"
                : "text-brand-slate-400 hover:text-brand-slate-100"
            }
            onPointerEnter={() => prefetchPage("brief")}
            onFocus={() => prefetchPage("brief")}
            onClick={() => setCurrentPage("brief")}
          >
            <p class="truncate">Brief</p>
          </button>
          <button
            class={
              currentPage() === "calendar"
                ? "text-brand-accent"
                : "text-brand-slate-400 hover:text-brand-slate-100"
            }
            onPointerEnter={() => prefetchPage("calendar")}
            onFocus={() => prefetchPage("calendar")}
            onClick={() => setCurrentPage("calendar")}
          >
            <p class="truncate">Calendar</p>
          </button>
          <button
            class={
              currentPage() === "charts"
                ? "text-brand-accent"
                : "text-brand-slate-400 hover:text-brand-slate-100"
            }
            onPointerEnter={() => prefetchPage("charts")}
            onFocus={() => prefetchPage("charts")}
            onClick={() => setCurrentPage("charts")}
          >
            <p class="truncate">Charts</p>
          </button>
          <Show when={isAdmin()}>
            <button
              class={
                currentPage() === "admin"
                  ? "text-brand-accent"
                  : "text-brand-slate-400 hover:text-brand-slate-100"
              }
              onPointerEnter={() => prefetchPage("admin")}
              onFocus={() => prefetchPage("admin")}
              onClick={() => setCurrentPage("admin")}
            >
              <p class="truncate">Admin</p>
            </button>
          </Show>
        </nav>
      </div>

      <div class="flex-1" />

      <div class="flex items-center gap-2">
        <AccountConnectionControl
          onBeforeOpen={() => setProfileOpen(false)}
        />
        <Show when={isAuthenticated()}>
          <div class="relative">
            <button
              class="flex items-center gap-2 px-3 py-1.5 text-sm font-semibold text-slate-100 border border-brand-border rounded-lg hover:border-brand-accent hover:text-brand-accent transition-colors"
              onClick={toggleProfileMenu}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              <span>Profile</span>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>

            {profileOpen() && (
              <>
                <div
                  class="fixed inset-0 z-40"
                  onClick={() => setProfileOpen(false)}
                />
                <div class="absolute right-0 top-full mt-2 w-56 bg-brand-surface border border-brand-border rounded-lg shadow-xl z-50 py-2">
                  <button
                    class="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-slate-200 hover:bg-brand-border/30 transition-colors"
                    onClick={handleMyVaultClick}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <rect x="3" y="4" width="18" height="16" rx="2" />
                      <path d="M7 12h10" />
                      <path d="M9 8h6" />
                      <path d="M9 16h6" />
                    </svg>
                    <span>My Vault</span>
                  </button>
                  <div class="border-t border-brand-border my-1" />
                  <button
                    class="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-brand-red-400 hover:bg-brand-border/30 transition-colors"
                    onClick={() => {
                      setProfileOpen(false);
                      logout();
                    }}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                      <polyline points="16 17 21 12 16 7" />
                      <line x1="21" y1="12" x2="9" y2="12" />
                    </svg>
                    <span>Sign out</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </Show>

        {/* Settings Button */}
        <button
          type="button"
          aria-label="Settings"
          aria-haspopup="dialog"
          aria-expanded={settingsOpen()}
          aria-controls="settings-dialog"
          class="flex h-9 w-9 items-center justify-center rounded-lg border border-brand-border bg-brand-surface text-brand-slate-400 transition-colors hover:text-brand-slate-100"
          onClick={handleOpenSettings}
        >
          <svg
            aria-hidden="true"
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>
      </div>
    </header>
  );
};

export default Header;
