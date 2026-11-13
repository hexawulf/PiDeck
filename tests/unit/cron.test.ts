import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cronEnvironment, parseCrontab, runCronEntry, splitPercent, toCronJob } from "../../server/services/cron";

describe("crontab parser", () => {
  it("reads plain five-field entries", () => {
    expect(parseCrontab("0 7 * * * /home/zk/bin/report.sh >> /home/zk/logs/r.log 2>&1\n")).toEqual([
      { schedule: "0 7 * * *", command: "/home/zk/bin/report.sh >> /home/zk/logs/r.log 2>&1", env: {} },
    ]);
  });

  it("accepts tabs, several spaces and leading whitespace", () => {
    const [e] = parseCrontab("   */15\t*   *\t* 1-5    /usr/bin/true  --flag\n");
    expect(e).toMatchObject({ schedule: "*/15 * * * 1-5", command: "/usr/bin/true  --flag" });
  });

  it("skips comments and blank lines, indented ones too", () => {
    expect(parseCrontab("# m h dom mon dow command\n\n   # 0 1 * * * /disabled.sh\n")).toEqual([]);
  });

  it("treats NAME=value lines as variables for the entries below, never as jobs", () => {
    const entries = parseCrontab([
      "SHELL=/bin/bash",
      'PATH = "/home/zk/bin:/usr/bin:/bin"',
      "0 1 * * * first.sh",
      "MAILTO=''",
      "0 2 * * * second.sh",
    ].join("\n"));
    expect(entries).toHaveLength(2);
    expect(entries[0].env).toEqual({ SHELL: "/bin/bash", PATH: "/home/zk/bin:/usr/bin:/bin" });
    expect(entries[1].env).toEqual({ SHELL: "/bin/bash", PATH: "/home/zk/bin:/usr/bin:/bin", MAILTO: "" });
  });

  it("keeps @reboot and friends with that as the schedule", () => {
    expect(parseCrontab("@reboot  /home/zk/bin/start.sh\n@Daily /bin/true\n")).toEqual([
      { schedule: "@reboot", command: "/home/zk/bin/start.sh", env: {} },
      { schedule: "@daily", command: "/bin/true", env: {} },
    ]);
  });

  it("leaves out lines that are neither", () => {
    expect(parseCrontab("0 7 * *\nnonsense here\n")).toEqual([]);
  });

  it("a command that contains = is still a job", () => {
    expect(parseCrontab("5 4 * * * FOO=bar /bin/run.sh\n")[0]).toMatchObject({ schedule: "5 4 * * *", command: "FOO=bar /bin/run.sh" });
  });

  it("lists a job in the Cron tab's shape", () => {
    expect(toCronJob({ schedule: "0 3 * * 0", command: "/home/zk/bin/backup.sh", env: {} })).toEqual({
      schedule: "0 3 * * 0", command: "/home/zk/bin/backup.sh", description: "Backup routine", status: "Active",
    });
  });
});

describe("cron's % rule", () => {
  it("leaves a command without % alone", () => {
    expect(splitPercent("date +ok")).toEqual({ command: "date +ok", stdin: null });
  });
  it("the first % ends the command; the rest is stdin, further % are newlines", () => {
    expect(splitPercent("mail -s hi root%line one%line two")).toEqual({ command: "mail -s hi root", stdin: "line one\nline two\n" });
  });
  it("\\% is a literal %", () => {
    expect(splitPercent("date +\\%F > /tmp/x")).toEqual({ command: "date +%F > /tmp/x", stdin: null });
    expect(splitPercent("cat%100\\% done")).toEqual({ command: "cat", stdin: "100% done\n" });
  });
});

describe("running a job", () => {
  let dir: string;
  const user = { username: "tester", homedir: os.tmpdir(), uid: 1, gid: 1, shell: "/bin/sh" } as os.UserInfo<string>;
  beforeEach(() => (dir = fs.mkdtempSync(path.join(os.tmpdir(), "pideck-cron-"))));
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
  const logs = () => fs.readdirSync(dir);

  it("gets cron's environment plus the crontab's variables, and nothing of PiDeck's", () => {
    process.env.SESSION_SECRET = "must-not-leak";
    const env = cronEnvironment({ schedule: "@daily", command: "x", env: { PATH: "/custom/bin", FOO: "1" } }, user);
    expect(env).toMatchObject({ HOME: os.tmpdir(), LOGNAME: "tester", USER: "tester", SHELL: "/bin/sh", PATH: "/custom/bin", FOO: "1" });
    expect(env).not.toHaveProperty("SESSION_SECRET");
    delete process.env.SESSION_SECRET;
  });

  it("really runs with that environment (no PiDeck secrets reach the job)", async () => {
    process.env.SESSION_SECRET = "must-not-leak";
    const r = await runCronEntry({ schedule: "@daily", command: 'echo "secret=[$SESSION_SECRET] user=$LOGNAME path=$PATH"', env: {} }, { logsDir: dir, user });
    delete process.env.SESSION_SECRET;
    expect(r).toMatchObject({ state: "finished", exitCode: 0 });
    const text = fs.readFileSync(path.join(dir, (r as { log: string }).log), "utf8");
    expect(text).toContain("secret=[] user=tester path=/usr/bin:/bin");
    expect(text).toContain("[pideck] exit 0");
  });

  it("reports a failing job's exit code and keeps its output", async () => {
    const r = await runCronEntry({ schedule: "@daily", command: "echo oops >&2; exit 3", env: {} }, { logsDir: dir, user });
    expect(r).toMatchObject({ state: "finished", exitCode: 3 });
    expect(fs.readFileSync(path.join(dir, (r as { log: string }).log), "utf8")).toContain("oops");
  });

  it("feeds the text after % to the job's stdin", async () => {
    const out = path.join(dir, "stdin.txt");
    const r = await runCronEntry({ schedule: "@daily", command: `cat > ${out}%one%two`, env: {} }, { logsDir: dir, user });
    expect(r).toMatchObject({ state: "finished", exitCode: 0 });
    expect(fs.readFileSync(out, "utf8")).toBe("one\ntwo\n");
  });

  it("removes its log when a successful job printed nothing (it redirects its own output)", async () => {
    const r = await runCronEntry({ schedule: "@daily", command: "true", env: {} }, { logsDir: dir, user });
    expect(r).toEqual({ state: "finished", exitCode: 0, log: null });
    expect(logs()).toEqual([]);
  });

  it("a long job is reported as still running, is not killed, and records its exit later", async () => {
    const r = await runCronEntry({ schedule: "@daily", command: "sleep 0.4; echo late", env: {} }, { logsDir: dir, user, waitMs: 50 });
    expect(r.state).toBe("running");
    const file = path.join(dir, (r as { log: string }).log);
    await new Promise((res) => setTimeout(res, 900));
    const text = fs.readFileSync(file, "utf8");
    expect(text).toContain("late");
    expect(text).toContain("[pideck] exit 0");
  });

  it("uses the crontab's SHELL when it sets one", async () => {
    const r = await runCronEntry({ schedule: "@daily", command: "echo $0", env: { SHELL: "/bin/bash" } }, { logsDir: dir, user });
    expect(fs.readFileSync(path.join(dir, (r as { log: string }).log), "utf8")).toContain("/bin/bash");
  });
});
