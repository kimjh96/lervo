import { resolve } from "node:path";
import { buildNativeCasArtifact } from "./build-native-artifact.mjs";

await buildNativeCasArtifact({ repositoryRoot: resolve(import.meta.dirname, "../../..") });
