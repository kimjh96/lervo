import { constants } from "node:fs";
import {
  access,
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

import { failNodeFleetApply } from "./node-fleet-apply-contract.js";
import { dependencyHash, type RuntimeDependencyClosure } from "./runtime-dependency-closure.js";

function packageDirectory(root: string, index: number): string {
  return resolve(root, ".lervo-packages", String(index));
}

function links(root: string, closure: RuntimeDependencyClosure): Array<[string, string]> {
  return [
    [resolve(root, closure.packages[0]!.name), packageDirectory(root, 0)],
    ...closure.packages.flatMap((entry, index) =>
      Object.entries(entry.dependencies).map(([name, target]): [string, string] => [
        resolve(packageDirectory(root, index), "node_modules", name),
        packageDirectory(root, target),
      ]),
    ),
  ];
}

/** Missing generated material is repairable; differing bytes or redirected links are conflicts. */
export async function inspectRuntimeDependencies(
  runtimeDirectory: string,
  closure: RuntimeDependencyClosure,
): Promise<"current" | "missing" | "conflict"> {
  const root = resolve(runtimeDirectory, "node_modules");
  let missing = false;
  const inspectDirectory = async (path: string): Promise<boolean> => {
    try {
      const info = await lstat(path);
      return info.isDirectory() && !info.isSymbolicLink();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false;
      missing = true;
      return true;
    }
  };
  if (
    !(await inspectDirectory(root)) ||
    !(await inspectDirectory(resolve(root, ".lervo-packages")))
  )
    return "conflict";
  const inspectFile = async (path: string, hash: string, executable: boolean): Promise<boolean> => {
    try {
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || dependencyHash(await readFile(path)) !== hash)
        return false;
      if (executable) await access(path, constants.X_OK);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false;
      missing = true;
      return true;
    }
  };
  for (const [index, entry] of closure.packages.entries()) {
    const directory = packageDirectory(root, index);
    const expectedFiles = new Set(entry.files.map((file) => file.path));
    const inspectTree = async (relativeDirectory: string): Promise<boolean> => {
      const path = resolve(directory, relativeDirectory);
      if (!(await inspectDirectory(path))) return false;
      let children;
      try {
        children = await readdir(path, { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
        return false;
      }
      for (const child of children) {
        if (relativeDirectory === "" && child.name === "node_modules") continue;
        const relativePath = relativeDirectory ? `${relativeDirectory}/${child.name}` : child.name;
        if (child.isDirectory()) {
          if (!(await inspectTree(relativePath))) return false;
        } else if (!child.isFile() || !expectedFiles.has(relativePath)) return false;
      }
      return true;
    };
    if (!(await inspectTree(""))) return "conflict";
    if (!(await inspectDirectory(resolve(directory, "node_modules")))) return "conflict";
    for (const file of entry.files) {
      if (
        !(await inspectFile(
          resolve(packageDirectory(root, index), file.path),
          file.hash,
          file.executable,
        ))
      )
        return "conflict";
    }
  }
  for (const [path, target] of links(root, closure)) {
    if (!(await inspectDirectory(dirname(path)))) return "conflict";
    try {
      const info = await lstat(path);
      if (!info.isSymbolicLink() || (await realpath(path)) !== (await realpath(target)))
        return "conflict";
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return "conflict";
      missing = true;
    }
  }
  if (
    !(await inspectFile(
      resolve(root, ".lervo-dependencies.json"),
      dependencyHash(closure.manifest),
      false,
    ))
  )
    return "conflict";
  return missing ? "missing" : "current";
}

export async function materializeRuntimeDependencies(
  runtimeDirectory: string,
  closure: RuntimeDependencyClosure,
): Promise<void> {
  const conflict = (): never =>
    failNodeFleetApply(
      "node_fleet_executable_invalid",
      "Installed runtime dependencies differ from the expected content.",
    );
  if ((await inspectRuntimeDependencies(runtimeDirectory, closure)) === "conflict") conflict();
  const root = resolve(runtimeDirectory, "node_modules");
  const writeExact = async (
    path: string,
    bytes: Buffer | string,
    executable: boolean,
  ): Promise<void> => {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    try {
      await writeFile(path, bytes, { flag: "wx", mode: executable ? 0o700 : 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (!(await readFile(path)).equals(typeof bytes === "string" ? Buffer.from(bytes) : bytes))
        conflict();
    }
    await chmod(path, executable ? 0o700 : 0o600);
  };
  for (const [index, entry] of closure.packages.entries()) {
    await mkdir(resolve(packageDirectory(root, index), "node_modules"), {
      recursive: true,
      mode: 0o700,
    });
    for (const file of entry.files) {
      const bytes = await readFile(resolve(entry.source, file.path));
      if (dependencyHash(bytes) !== file.hash) conflict();
      await writeExact(resolve(packageDirectory(root, index), file.path), bytes, file.executable);
    }
  }
  for (const [path, target] of links(root, closure)) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    try {
      await symlink(
        process.platform === "win32" ? target : relative(dirname(path), target),
        path,
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if ((await realpath(path)) !== (await realpath(target))) conflict();
    }
  }
  await writeExact(resolve(root, ".lervo-dependencies.json"), closure.manifest, false);
  if ((await inspectRuntimeDependencies(runtimeDirectory, closure)) !== "current") conflict();
}
