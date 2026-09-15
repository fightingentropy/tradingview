import { Component, For, Show, createSignal } from "solid-js";
import { isAdmin, isAuthenticated, logout } from "../stores/auth";
import { currentPage, MAIN_PAGES, setCurrentPage } from "../stores/page";
import { openSettings, settingsOpen } from "../stores/settings";
import { prefetchPage } from "../lib/routeModules";
import AccountConnectionControl from "./AccountConnectionControl";

const Header: Component = () => {
  const [profileOpen, setProfileOpen] = createSignal(false);

  const toggleProfileMenu = () => {
    const next = !profileOpen();
    setProfileOpen(next);
  };

  const handleOpenSettings = () => {
    setProfileOpen(false);
    openSettings();
  };

  return (
    <header class="app-header hidden md:flex">
      <div class="flex h-full items-center gap-8">
        <button onClick={() => setCurrentPage("trade")} class="app-wordmark">
          <svg
            aria-hidden="true"
            width="23"
            height="23"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
          >
            <path d="M6 3v18M12 6v13M18 2v18" />
            <path
              d="M3.5 7h5v7h-5zM9.5 10h5v5h-5zM15.5 5h5v8h-5z"
              fill="var(--color-brand-screen)"
            />
          </svg>
          <span>TradingView</span>
        </button>
        <nav class="primary-nav" aria-label="Main navigation">
          <For each={MAIN_PAGES}>
            {(page) => (
              <button
                class="nav-link"
                aria-current={currentPage() === page.id ? "page" : undefined}
                onPointerEnter={() => prefetchPage(page.id)}
                onFocus={() => prefetchPage(page.id)}
                onClick={() => setCurrentPage(page.id)}
              >
                {page.label}
              </button>
            )}
          </For>
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
        <AccountConnectionControl onBeforeOpen={() => setProfileOpen(false)} />
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
