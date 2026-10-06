// Builds an installable, fully offline Android APK (downloads/Aligned.apk) without Gradle.
//
// Requirements (paths can be overridden with environment variables):
//   JAVA_HOME           JDK 17+
//   ANDROID_SDK_ROOT    Android SDK with build-tools;35.0.0 and platforms;android-35
//   ALIGNED_KEYSTORE    release keystore (created on first build if missing; keep it safe and
//                       reuse it, or Android will refuse to update installed copies)
//   ALIGNED_KEYSTORE_PASSWORD
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const toolsRoot = "C:/Users/Public/AlignedBuild";
const javaHome = process.env.JAVA_HOME || join(toolsRoot, "jdk", "jdk-17.0.20.1+1");
const sdk = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME || join(toolsRoot, "sdk");
const buildTools = join(sdk, "build-tools", "35.0.0");
const androidJar = join(sdk, "platforms", "android-35", "android.jar");
// Prefer the keystore kept (git-ignored) in the repository folder, then the shared tools folder.
const keystore = process.env.ALIGNED_KEYSTORE || (existsSync(join(root, "aligned-release.jks")) ? join(root, "aligned-release.jks") : join(toolsRoot, "aligned-release.jks"));
const storePassword = process.env.ALIGNED_KEYSTORE_PASSWORD || "aligned-local-release";
const isWindows = process.platform === "win32";
const exe = (name) => join(buildTools, isWindows ? `${name}.exe` : name);
const bat = (name) => join(buildTools, isWindows ? `${name}.bat` : name);
const javaBin = (name) => join(javaHome, "bin", isWindows ? `${name}.exe` : name);

const versionName = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const [major, minor, patch] = versionName.split(".").map(Number);
const versionCode = major * 10000 + minor * 100 + patch;

const out = join(root, "android", "build");
const run = (command, args) => {
  const shell = command.endsWith(".bat");
  execFileSync(shell ? `"${command}"` : command, shell ? args.map((arg) => `"${arg}"`) : args, {
    stdio: ["ignore", "inherit", "inherit"],
    shell,
    env: { ...process.env, JAVA_HOME: javaHome, PATH: `${join(javaHome, "bin")}${isWindows ? ";" : ":"}${process.env.PATH}` }
  });
};

for (const required of [javaBin("javac"), exe("aapt2"), androidJar]) {
  if (!existsSync(required)) throw new Error(`Missing build tool: ${required}`);
}

rmSync(out, { recursive: true, force: true });
for (const folder of ["compiled-res", "gen", "classes", "dex", "assets/www"]) mkdirSync(join(out, folder), { recursive: true });

// The APK ships the same files the website serves, minus the service worker (assets are already local).
for (const file of ["index.html", "manifest.webmanifest", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png"]) {
  copyFileSync(join(root, file), join(out, "assets", "www", file));
}

run(exe("aapt2"), ["compile", "--dir", join(root, "android", "res"), "-o", join(out, "compiled-res", "res.zip")]);
run(exe("aapt2"), [
  "link", "-o", join(out, "unsigned.apk"),
  "-I", androidJar,
  "--manifest", join(root, "android", "AndroidManifest.xml"),
  "--java", join(out, "gen"),
  "--min-sdk-version", "24",
  "--target-sdk-version", "34",
  "--version-code", String(versionCode),
  "--version-name", versionName,
  join(out, "compiled-res", "res.zip")
]);

const sources = [
  join(root, "android", "src", "com", "grandpatin", "aligned", "MainActivity.java"),
  join(out, "gen", "com", "grandpatin", "aligned", "R.java")
];
run(javaBin("javac"), ["-encoding", "UTF-8", "--release", "11", "-classpath", androidJar, "-d", join(out, "classes"), ...sources]);

const classFiles = execFileSync(isWindows ? "cmd" : "find", isWindows ? ["/c", "dir", "/s", "/b", join(out, "classes", "*.class")] : [join(out, "classes"), "-name", "*.class"], { encoding: "utf8" })
  .split(/\r?\n/).filter(Boolean);
run(bat("d8"), ["--release", "--min-api", "24", "--lib", androidJar, "--output", join(out, "dex"), ...classFiles]);

// Add classes.dex and the web assets. jar always writes "/" separators; aapt2 -A on Windows writes "\\",
// which Android's AssetManager cannot open.
run(javaBin("jar"), ["uf", join(out, "unsigned.apk"), "-C", join(out, "dex"), "classes.dex"]);
run(javaBin("jar"), ["uf", join(out, "unsigned.apk"), "-C", out, "assets"]);
run(exe("zipalign"), ["-f", "-p", "4", join(out, "unsigned.apk"), join(out, "aligned.apk")]);

if (!existsSync(keystore)) {
  mkdirSync(dirname(keystore), { recursive: true });
  run(javaBin("keytool"), [
    "-genkeypair", "-keystore", keystore, "-alias", "aligned", "-keyalg", "RSA", "-keysize", "3072",
    "-validity", "10000", "-storepass", storePassword, "-keypass", storePassword,
    "-dname", "CN=Aligned, O=GrandpaTin"
  ]);
}

const destination = join(root, "downloads", "Aligned.apk");
mkdirSync(dirname(destination), { recursive: true });
run(bat("apksigner"), [
  "sign", "--ks", keystore, "--ks-key-alias", "aligned", "--ks-pass", `pass:${storePassword}`,
  "--out", destination, join(out, "aligned.apk")
]);
run(bat("apksigner"), ["verify", destination]);
const entries = execFileSync(javaBin("jar"), ["tf", destination], { encoding: "utf8" }).split(/\r?\n/);
if (!entries.includes("assets/www/index.html") || entries.some((entry) => entry.includes("\\"))) {
  throw new Error("APK assets are not stored at assets/www/ with forward slashes");
}
rmSync(join(root, "downloads", "Aligned.apk.idsig"), { force: true });
writeFileSync(join(out, "version.txt"), `${versionName} (${versionCode})\n`);
console.log(`Built downloads/Aligned.apk ${versionName} (${versionCode})`);
