import { useEffect } from "react";
import { createIntl, RawIntlProvider } from "react-intl";

import { bindConnection } from "../features/connection";
import { bindStart, bindStartDraft } from "../features/start";
import { bindWorkspaces, notificationMessages, useWorkspaceStore } from "../features/workspaces";
import { chooseLocale, defaultLocale, messagesFor } from "../i18n/catalog";
import { isCommandKey } from "../platform/keyboard";
import { transition } from "../platform/transition";
import { type Adapters, AdaptersProvider, type Notifier } from "../ports";
import { Frame } from "./Frame";

const locale = chooseLocale(navigator.languages);
const intl = createIntl({ locale, defaultLocale, messages: messagesFor(locale) });

/** The application root: it binds the models to the adapters and renders the frame. */
export function App(props: { adapters: Adapters; notifier: Notifier }) {
  const { adapters, notifier } = props;
  useEffect(() => {
    const { host, commands, drafts } = adapters;
    const unbind = [
      bindConnection(host),
      bindWorkspaces({
        client: host,
        commands,
        notifier,
        isFocused: () => document.hasFocus(),
        text: (kind, title) => ({ title, body: intl.formatMessage(notificationMessages[kind]) }),
      }),
      bindStart(),
      bindStartDraft(drafts),
    ];
    // ⌘N (Ctrl+N elsewhere) opens the start screen, as the "New work" row shows.
    const shortcut = (event: KeyboardEvent) => {
      if (!isCommandKey(event, "n")) return;
      event.preventDefault();
      transition(() => useWorkspaceStore.getState().newWork());
    };
    window.addEventListener("keydown", shortcut);
    return () => {
      window.removeEventListener("keydown", shortcut);
      for (const release of unbind) release();
    };
  }, [adapters, notifier]);
  return (
    <RawIntlProvider value={intl}>
      <AdaptersProvider adapters={adapters}>
        <Frame />
      </AdaptersProvider>
    </RawIntlProvider>
  );
}
