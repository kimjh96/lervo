import { useEffect } from "react";
import { createIntl, RawIntlProvider } from "react-intl";

import { bindConnection, bindHostUpdate } from "../features/connection";
import { bindProjects } from "../features/projects";
import { bindProviders } from "../features/providers";
import { bindProfile } from "../features/agents";
import { bindStart, bindStartDraft } from "../features/start";
import { bindWorkspaces, notificationMessages, useWorkspaceStore } from "../features/workspaces";
import { chooseLocale, defaultLocale, messagesFor } from "../i18n/catalog";
import { isCommandKey } from "../platform/keyboard";
import { type Adapters, AdaptersProvider, type Notifier } from "../ports";
import { Frame } from "./Frame";
import { useLaunched } from "./launch";

const locale = chooseLocale(navigator.languages);
const intl = createIntl({ locale, defaultLocale, messages: messagesFor(locale) });

/**
 * The application root: it binds the models to the adapters and renders the frame once the
 * launch view leaves.
 */
export function App(props: { adapters: Adapters; notifier: Notifier }) {
  const { adapters, notifier } = props;
  const launched = useLaunched();
  useEffect(() => {
    const { host, replacement, commands, drafts, lists, projects, images, files, choosers } =
      adapters;
    const unbind = [
      bindConnection(host),
      bindHostUpdate(replacement),
      bindWorkspaces({
        client: host,
        commands,
        lists,
        notifier,
        isFocused: () => document.hasFocus(),
        text: (kind, title) => ({ title, body: intl.formatMessage(notificationMessages[kind]) }),
      }),
      bindProviders({ client: host, commands }),
      bindProjects({ commands, lists, memory: projects, images, files, choosers }),
      bindStart(),
      bindProfile(),
      bindStartDraft(drafts),
    ];
    // ⌘N (Ctrl+N elsewhere) opens the start screen, as the "New work" row shows.
    const shortcut = (event: KeyboardEvent) => {
      if (!isCommandKey(event, "n")) return;
      event.preventDefault();
      useWorkspaceStore.getState().newWork();
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
        {/* motion: Launch */}
        {launched ? <Frame /> : null}
      </AdaptersProvider>
    </RawIntlProvider>
  );
}
