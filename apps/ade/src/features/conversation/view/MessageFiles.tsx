import { useEffect, useState } from "react";
import { useIntl } from "react-intl";

import { type AttachedFile, type Files, useFiles } from "../../../ports";
import { FileChip } from "../../../ui/FileChip";
import { baseName, extension, folderName } from "../model/files";
import styles from "./MessageFiles.module.css";

/**
 * What the shell said about each path a message named, kept for the interface's life: rows of a
 * long conversation mount again as it scrolls, and the answer rarely changes meanwhile.
 */
const known = new Map<string, AttachedFile>();

function useDescribed(files: Files, paths: readonly string[]): ReadonlyMap<string, AttachedFile> {
  const [, setVersion] = useState(0);
  const key = paths.join("\n");
  useEffect(() => {
    const unknown = key.split("\n").filter((path) => !known.has(path));
    if (unknown.length === 0) return;
    let mounted = true;
    files.describe(unknown).then(
      (described) => {
        for (const file of described) known.set(file.path, file);
        if (mounted) setVersion((version) => version + 1);
      },
      () => undefined,
    );
    return () => {
      mounted = false;
    };
  }, [files, key]);
  return known;
}

/**
 * The files a user message named, inside its bubble above the text (file mockup, "A"). Each chip
 * shows the file in Finder; one that was moved or deleted since is faint and says so.
 */
export function MessageFiles(props: { paths: readonly string[] }) {
  const intl = useIntl();
  const files = useFiles();
  const described = useDescribed(files, props.paths);
  return (
    <div className={styles.files}>
      {props.paths.map((path) => {
        const file = described.get(path);
        const name = file?.name ?? baseName(path);
        const folder = folderName(path);
        const missing = file !== undefined && !file.exists;
        return (
          <FileChip
            key={path}
            size="message"
            name={name}
            detail={missing ? intl.formatMessage({ id: "conversation.files.missing" }) : folder}
            badge={extension(name).slice(0, 4).toUpperCase()}
            folder={file?.directory}
            missing={missing}
            label={intl.formatMessage({ id: "conversation.files.label" }, { name, folder })}
            onOpen={() => files.reveal(path)}
          />
        );
      })}
    </div>
  );
}
