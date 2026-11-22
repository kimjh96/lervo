import { useEffect, useMemo } from "react";
import { createIntl, IntlProvider } from "react-intl";

import { bindConnection } from "../features/connection";
import { bindWorkspaces } from "../features/workspaces";
import { chooseLocale, defaultLocale, messagesFor } from "../i18n/catalog";
import type { Notifier } from "../platform/notifications";
import { ApplicationCommands, type SessionHostClient } from "../platform/session-host";
import { Frame } from "./Frame";
import { SessionHostProvider } from "./session-host-context";

const locale = chooseLocale(navigator.languages);
const messages = messagesFor(locale);
const intl = createIntl({ locale, defaultLocale, messages });

/** The application root: the catalog, the session-host client, and the frame. */
export function App(props: { client: SessionHostClient; notifier: Notifier }) {
  const { client, notifier } = props;
  const commands = useMemo(() => new ApplicationCommands(client), [client]);
  useEffect(() => {
    const unbindConnection = bindConnection(client);
    const unbindWorkspaces = bindWorkspaces({
      client,
      commands,
      notifier,
      isFocused: () => document.hasFocus(),
      text: (kind, title) => ({
        title,
        body: intl.formatMessage({ id: `notifications.${kind}` }),
      }),
    });
    client.start();
    return () => {
      unbindConnection();
      unbindWorkspaces();
    };
  }, [client, commands, notifier]);
  return (
    <IntlProvider locale={locale} defaultLocale={defaultLocale} messages={messages}>
      <SessionHostProvider client={client} commands={commands}>
        <Frame />
      </SessionHostProvider>
    </IntlProvider>
  );
}
