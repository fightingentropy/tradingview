import { createSignal } from "solid-js";

const [settingsOpen, setSettingsOpen] = createSignal(false);

const openSettings = () => setSettingsOpen(true);
const closeSettings = () => setSettingsOpen(false);

export { settingsOpen, openSettings, closeSettings };
