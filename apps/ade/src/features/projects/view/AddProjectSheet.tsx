import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FormattedMessage, useIntl } from "react-intl";

import { ChevronDownIcon, FolderIcon } from "../../../ui/icons";
import { InlineAlert } from "../../../ui/InlineAlert";
import { Presence } from "../../../ui/Presence";
import { Waiting } from "../../../ui/Waiting";
import {
  addFromSource,
  chooseLocation,
  clearAddFailure,
  readLocation,
  useAddStore,
} from "../model/add";
import { closeProjectSheet } from "../model/controller";
import { useAddDependencies } from "../model/hooks";
import { folderNameFor, linkName, projectSourceOf } from "../model/sources";
import { useProjectStore } from "../model/store";
import styles from "./AddProjectSheet.module.css";

/** A path as the window shows it: under the home folder, it starts with `~`. */
export function shortPath(path: string): string {
  return path.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/u, "~");
}

/** A folder's own name, as the location shows it, such as `Lervo` for `~/Lervo`. */
export function folderOf(path: string): string {
  return path.replace(/\/+$/u, "").split("/").at(-1) ?? path;
}

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The "Clone Repository" and "New Project" windows (Lervo ADE projects, "Adding a project"): a
 * small window over Lervo with one labeled field, the location as a path with a Change button
 * that opens the system folder panel, and Cancel and Clone or Create. Return adds; Escape, Cancel,
 * or a click outside closes. Adding starts no work and selects the project. It opens and closes as
 * ADE motion's overlays do.
 */
function Sheet(props: { kind: "clone" | "new" }) {
  const intl = useIntl();
  const dependencies = useAddDependencies();
  const [value, setValue] = useState("");
  const [closing, setClosing] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const adding = useAddStore((store) => store.adding);
  const failure = useAddStore((store) => store.failure);
  const location = useAddStore((store) => store.location);
  const { kind } = props;
  const { commands } = dependencies;
  const source = kind === "clone" ? projectSourceOf(value) : null;
  const ready =
    adding === null && (kind === "clone" ? source?.kind === "clone" : value.trim().length > 0);
  const folder = kind === "clone" ? linkName(value.trim()) : folderNameFor(value.trim());
  const destination =
    location === null ? null : folder === null ? location : `${location}/${folder}`;

  useEffect(() => {
    clearAddFailure();
    field.current?.focus();
    void readLocation(commands).catch(() => undefined);
  }, [commands]);

  const close = () => {
    if (reducedMotion()) closeProjectSheet();
    else setClosing(true);
  };
  // Escape closes the window wherever the focus is in it.
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (reducedMotion()) closeProjectSheet();
      else setClosing(true);
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, []);
  const submit = () => {
    if (!ready) return;
    const added =
      kind === "clone" && source !== null
        ? addFromSource(dependencies, source)
        : addFromSource(dependencies, {
            kind: "new",
            name: [...value.trim()].slice(0, 80).join(""),
          });
    void added;
  };

  return createPortal(
    <div
      className={styles.backdrop}
      data-closing={closing ? "" : undefined}
      onPointerDown={(event) => {
        if (
          !(event.target instanceof Node) ||
          !event.currentTarget.lastElementChild?.contains(event.target)
        )
          close();
      }}
    >
      <div className={styles.blur} />
      <div className={styles.veil} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-sheet-title"
        className={styles.sheet}
        onAnimationEnd={(event) => {
          if (closing && event.target === event.currentTarget) closeProjectSheet();
        }}
      >
        <div className={styles.content}>
          <div className={styles.heading}>
            <h2 id="project-sheet-title" className={styles.title}>
              {/* motion: Overlays: command palette, menus, popovers */}
              {kind === "clone" ? (
                <FormattedMessage id="projects.sheet.clone.title" />
              ) : (
                <FormattedMessage id="projects.sheet.new.title" />
              )}
            </h2>
            <p className={styles.subtitle}>
              {/* motion: Overlays: command palette, menus, popovers */}
              {kind === "clone" ? (
                <FormattedMessage id="projects.sheet.clone.subtitle" />
              ) : (
                <FormattedMessage id="projects.sheet.new.subtitle" />
              )}
            </p>
          </div>
          <label className={styles.label}>
            {/* motion: Overlays: command palette, menus, popovers */}
            {kind === "clone" ? (
              <FormattedMessage id="projects.sheet.clone.field" />
            ) : (
              <FormattedMessage id="projects.sheet.new.field" />
            )}
            <input
              ref={field}
              className={styles.input}
              value={value}
              spellCheck={false}
              disabled={adding !== null}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing) submit();
              }}
            />
          </label>
          <div className={styles.label}>
            <FormattedMessage id="projects.sheet.location" />
            <button
              type="button"
              className={styles.where}
              title={destination === null ? undefined : shortPath(destination)}
              disabled={adding !== null}
              onClick={() =>
                void chooseLocation(
                  dependencies,
                  intl.formatMessage({ id: "projects.sheet.location.title" }),
                )
              }
            >
              <FolderIcon size="md" />
              <span className={styles.whereName}>
                {location === null ? "" : folderOf(location)}
              </span>
              <ChevronDownIcon size="sm" />
            </button>
          </div>
          <Presence className={styles.failure}>
            {/* motion: Inline errors */}
            {failure === null ? null : (
              <InlineAlert size="caption">
                <FormattedMessage id="projects.sheet.failed" values={{ code: failure }} />
              </InlineAlert>
            )}
          </Presence>
          <div className={styles.actions}>
            <Presence as="span">
              {adding === null ? null : (
                <Waiting
                  label={
                    kind === "clone"
                      ? intl.formatMessage({ id: "projects.sheet.clone.adding" })
                      : intl.formatMessage({ id: "projects.sheet.new.adding" })
                  }
                />
              )}
            </Presence>
            <button type="button" className={styles.secondary} onClick={close}>
              <FormattedMessage id="projects.sheet.cancel" />
            </button>
            <button type="button" className={styles.primary} disabled={!ready} onClick={submit}>
              {/* motion: Overlays: command palette, menus, popovers */}
              {kind === "clone" ? (
                <FormattedMessage id="projects.sheet.clone.submit" />
              ) : (
                <FormattedMessage id="projects.sheet.new.submit" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Shows the window "Add Project" opened, from the switcher or the first run. */
export function AddProjectSheet() {
  const sheet = useProjectStore((store) => store.sheet);
  // motion: Overlays: command palette, menus, popovers
  return sheet === null ? null : <Sheet key={sheet} kind={sheet} />;
}
