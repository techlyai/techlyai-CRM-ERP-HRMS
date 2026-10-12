// Local verification helper for a network-restricted workstation. Normal setup uses npm ci.
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const npmModules = "C:/Program Files/nodejs/node_modules/npm/node_modules";
const cacache = require(npmModules + "/cacache");
const semver = require(npmModules + "/semver");
const cache = "C:/Users/kamal/AppData/Local/npm-cache/_cacache";
const root = process.cwd();
function untar(buffer, dest) {
  const tar = zlib.gunzipSync(buffer);
  let nextPath;
  for (let offset = 0; offset + 512 <= tar.length; ) {
    const h = tar.subarray(offset, offset + 512);
    let name = h.subarray(0, 100).toString().replace(/\0.*$/s, "");
    if (!name) break;
    const size =
      parseInt(
        h.subarray(124, 136).toString().replace(/\0.*$/s, "").trim(),
        8,
      ) || 0;
    const type = String.fromCharCode(h[156]);
    if (type === "x" || type === "L") {
      const value = tar.subarray(offset + 512, offset + 512 + size).toString();
      nextPath =
        type === "L"
          ? value.replace(/\0.*$/s, "")
          : value.match(/(?:^|\n)\d+ path=([^\n]+)/)?.[1];
      offset += 512 + Math.ceil(size / 512) * 512;
      continue;
    }
    const prefix = h.subarray(345, 500).toString().replace(/\0.*$/s, "");
    name = nextPath || (prefix ? prefix + "/" + name : name);
    nextPath = undefined;
    const rel = name.replace(/^[^/]+\//, "");
    const target = path.resolve(dest, rel);
    if (
      !target.startsWith(path.resolve(dest) + path.sep) &&
      target !== path.resolve(dest)
    )
      throw Error("Invalid archive path");
    if (h[156] === 48 || h[156] === 0) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, tar.subarray(offset + 512, offset + 512 + size));
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
}
async function main() {
  const entries = await cacache.ls(cache);
  const available = new Map();
  for (const [key, item] of Object.entries(entries)) {
    const m = key.match(
      /https:\/\/registry\.npmjs\.org\/(.+)\/-\/[^/]+-([0-9][^/]*)\.tgz$/,
    );
    if (!m || !semver.valid(m[2])) continue;
    const name = decodeURIComponent(m[1]);
    if (!available.has(name)) available.set(name, []);
    available.get(name).push({ version: m[2], key, integrity: item.integrity });
  }
  const installed = new Map();
  const missing = new Set();
  const lock = {};
  const visited = new Set();
  async function install(name, range, parent = root, optional = false) {
    if (
      name === "fsevents" ||
      (/(?:linux|darwin|android|freebsd|openbsd|sunos|aix)/.test(name) &&
        /swc|esbuild|sharp/.test(name))
    )
      return;
    const current = installed.get(name);
    if (current && semver.satisfies(current, range)) return;
    const choices = (available.get(name) || [])
      .filter((x) => semver.satisfies(x.version, range))
      .sort((a, b) => semver.rcompare(a.version, b.version));
    if (!choices.length) {
      if (!optional) missing.add(name + "@" + range);
      return;
    }
    const choice = choices[0];
    const base = current ? parent : root;
    const dest = path.join(base, "node_modules", name);
    const existing = path.join(dest, "package.json");
    if (visited.has(dest + ":" + choice.version)) return;
    visited.add(dest + ":" + choice.version);
    const result = await cacache.get(cache, choice.key);
    untar(result.data, dest);
    if (!current) installed.set(name, choice.version);
    const pkg = JSON.parse(fs.readFileSync(existing));
    lock[path.relative(root, dest).replaceAll("\\", "/")] = {
      version: pkg.version,
      resolved:
        "https://registry.npmjs.org/" +
        name +
        "/-/" +
        name.split("/").pop() +
        "-" +
        pkg.version +
        ".tgz",
      integrity: choice.integrity,
      dependencies: pkg.dependencies,
      optionalDependencies: pkg.optionalDependencies,
      os: pkg.os,
      cpu: pkg.cpu,
      optional: optional || undefined,
    };
    for (const [dep, r] of Object.entries(pkg.dependencies || {}))
      await install(dep, r, dest);
    for (const [dep, r] of Object.entries(pkg.optionalDependencies || {})) {
      const found = (available.get(dep) || []).find((v) =>
        semver.satisfies(v.version, r),
      );
      if (dep.startsWith("@next/swc-")) {
        const bits = dep.slice(10).split("-");
        lock["node_modules/" + dep] = {
          version: r,
          resolved:
            "https://registry.npmjs.org/" +
            dep +
            "/-/" +
            dep.split("/").pop() +
            "-" +
            r +
            ".tgz",
          integrity: found?.integrity,
          optional: true,
          os: [bits[0]],
          cpu: [bits[1]],
        };
      }
      await install(dep, r, dest, true);
    }
  }
  const pkg = JSON.parse(fs.readFileSync("package.json"));
  for (const [name, range] of Object.entries({
    ...pkg.dependencies,
    ...pkg.devDependencies,
  }))
    await install(name, range);
  fs.mkdirSync("node_modules/.bin", { recursive: true });
  for (const [name] of installed) {
    const dest = path.join(root, "node_modules", name);
    const pkg = JSON.parse(fs.readFileSync(path.join(dest, "package.json")));
    const bins =
      typeof pkg.bin === "string"
        ? { [name.split("/").pop()]: pkg.bin }
        : pkg.bin || {};
    for (const [cmd, file] of Object.entries(bins))
      fs.writeFileSync(
        path.join(root, "node_modules/.bin", cmd + ".cmd"),
        '@echo off\r\nnode "%~dp0\\..\\' +
          name.replaceAll("/", "\\") +
          "\\" +
          file.replaceAll("/", "\\") +
          '" %*\r\n',
      );
  }
  if (missing.size) {
    console.error("Missing cached packages:", [...missing].join(", "));
    process.exitCode = 1;
  } else {
    fs.writeFileSync(
      "package-lock.json",
      JSON.stringify(
        {
          name: pkg.name,
          version: pkg.version,
          lockfileVersion: 3,
          requires: true,
          packages: {
            "": {
              name: pkg.name,
              version: pkg.version,
              dependencies: pkg.dependencies,
              devDependencies: pkg.devDependencies,
            },
            ...lock,
          },
        },
        null,
        2,
      ) + "\n",
    );
    console.log("Installed", installed.size, "cached packages.");
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
