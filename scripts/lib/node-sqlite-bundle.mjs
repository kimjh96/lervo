const sqliteExperimentalWarning = "SQLite is an experimental feature and might change at any time";

const compatibilityModule = `
const __lervoOriginalEmitWarning = process.emitWarning;
let __lervoSqlite;
try {
  process.emitWarning = function (warning, type, ...details) {
    if (String(warning) === ${JSON.stringify(sqliteExperimentalWarning)} && type === "ExperimentalWarning") return;
    return __lervoOriginalEmitWarning.call(process, warning, type, ...details);
  };
  __lervoSqlite = require("node:sqlite");
} finally {
  process.emitWarning = __lervoOriginalEmitWarning;
}
export const DatabaseSync = __lervoSqlite.DatabaseSync;
export const StatementSync = __lervoSqlite.StatementSync;
export const constants = __lervoSqlite.constants;
export const backup = __lervoSqlite.backup;
`;

export const nodeSqliteBundlePlugin = {
  name: "lervo-node-sqlite-compatibility",
  setup(build) {
    build.onResolve({ filter: /^node:sqlite$/ }, (args) =>
      args.namespace === "lervo-node-sqlite"
        ? { path: "node:sqlite", external: true }
        : {
            path: "node:sqlite",
            namespace: "lervo-node-sqlite",
          },
    );
    build.onLoad({ filter: /.*/, namespace: "lervo-node-sqlite" }, () => ({
      contents: compatibilityModule,
      loader: "js",
    }));
  },
};
