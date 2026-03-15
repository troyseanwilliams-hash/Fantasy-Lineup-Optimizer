import fs from "fs";

export async function writeFile(path, content) {
  fs.writeFileSync(path, content);
  return "File updated";
}