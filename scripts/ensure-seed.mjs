import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { execSync } from "child_process";

const dbPath = path.join(process.cwd(), "data", "app.db");

let needsSeed = true;
if (fs.existsSync(dbPath)) {
  try {
    const db = new Database(dbPath, { readonly: true });
    const row = db.prepare("SELECT COUNT(*) as c FROM equipment").get();
    needsSeed = row.c === 0;
    db.close();
  } catch {
    needsSeed = true;
  }
}

if (needsSeed) {
  console.log("[ensure-seed] 설비 데이터가 없어 시드를 실행합니다...");
  execSync("npx tsx scripts/seed.ts", { stdio: "inherit" });
} else {
  console.log("[ensure-seed] 기존 데이터 발견, 시드를 건너뜁니다.");
}
