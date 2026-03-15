import { execSync } from "child_process";

export async function commit(message) {
  execSync("git add .");
  execSync(`git commit -m "${message}"`);
  execSync("git push");
  return "Code pushed to repo";
}