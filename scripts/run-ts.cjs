// TypeScript runner without an external transpiler process (restricted Windows development).
const ts = require("typescript");
const fs = require("node:fs");
const path = require("node:path");
require.extensions[".ts"] = (module, file) => {
  const source = fs.readFileSync(file, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  module._compile(output, file);
};
require(path.resolve(process.argv[2]));
