import fs from "fs";

export async function readFile(path) {
  return fs.readFileSync(path, "utf8");
}