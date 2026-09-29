// Redaction on the agent before a log line leaves the host (H3 Track B).
import { describe, expect, it } from "vitest";
import { REDACTED, redactLine } from "../../server/services/agent-logs/redact";

const R = REDACTED;

describe("redactLine: secrets are replaced", () => {
  it.each([
    // Authorization headers (whole value, any scheme)
    ["Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig", `Authorization: ${R}`],
    ["> authorization: Basic dXNlcjpwYXNz", `> authorization: ${R}`],
    ['{"headers":{"Authorization":"Token abc123def456"}}', `{"headers":{"Authorization":"${R}"}}`],
    ["Proxy-Authorization: Digest username=x", `Proxy-Authorization: ${R}`],
    // Bearer anywhere
    ["curl -H 'x: Bearer ghp_1234567890abcdef' https://api", `curl -H 'x: Bearer ${R}' https://api`],
    ["token type bearer AbC.dEf-123_456", `token type bearer ${R}`],
    // key = / : value
    ["password=hunter22", `password=${R}`],
    ["DB_PASSWORD: s3cr3t!", `DB_PASSWORD: ${R}`],
    ["passwd = abc123", `passwd = ${R}`],
    ["login ok token=abcd1234 user=zk", `login ok token=${R} user=zk`],
    ["GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxx", `GITHUB_TOKEN=${R}`],
    ["access_token: ya29.a0AfH6SMB", `access_token: ${R}`],
    ["client_secret=AbC123&grant_type=x", `client_secret=${R}&grant_type=x`],
    ["api_key=12345abcdef", `api_key=${R}`],
    ["X-Api-Key: 0123456789", `X-Api-Key: ${R}`],
    ["apikey:abc", `apikey:${R}`],
    ['{"password": "p@ss word", "user": "zk"}', `{"password": "${R}", "user": "zk"}`],
    ["secret='xyz'", `secret='${R}'`],
    ["token=\"a b c\" next", `token="${R}" next`],
    ["GET /cb?code=1&state=2&token=QWERTY HTTP/1.1", `GET /cb?code=1&state=2&token=${R} HTTP/1.1`],
    // URL credentials
    ["postgres://pideck:CHANGE_ME@localhost:5432/pideck", `postgres://pideck:${R}@localhost:5432/pideck`],
    ["fetching https://user:p4ss@example.org/repo.git", `fetching https://user:${R}@example.org/repo.git`],
  ])("%s", (input, expected) => {
    expect(redactLine(input).text).toBe(expected);
  });

  it("counts every replaced span", () => {
    const r = redactLine("password=a1 token=b2 postgres://u:p@h/db Authorization: Bearer zzzzzzzz");
    expect(r.count).toBe(4);
    expect(r.text).not.toMatch(/a1|b2|:p@|zzzzzzzz/);
  });

  it("a password without a URL user is caught when its key names it", () => {
    expect(redactLine("REDIS_PASSWORD=onlypass").text).toBe(`REDIS_PASSWORD=${R}`);
  });
});

describe("redactLine: false positives stay untouched", () => {
  it.each([
    "Sep 29 08:12:01 piapps2 sshd[123]: Failed password for invalid user admin from 1.2.3.4 port 22",
    "Sep 29 08:12:01 piapps2 sshd[123]: Accepted publickey for zk from 192.168.50.102",
    "pam_unix(sshd:auth): authentication failure; logname= uid=0",
    "openai usage: max_tokens=512 prompt_tokens: 12 completion_tokens: 30",
    "token_count: 3, tokens=7",
    "tokenizer=bert-base loaded",
    "password changed for user zk",
    "secret: false",
    "require_password=true",
    "api_key: null",
    "token=${GITHUB_TOKEN}",
    'password=""',
    "password: ********",
    "The bearer of this letter",
    "Bearer ok", // too short to be a token
    "http://example.org:8080/path?q=1",
    "ssh zk@192.168.50.120",
    "email zk@hexawulf.dev sent",
    "[sonarr] Info: Series refresh complete (token bucket: 5/10)",
    "2026-09-29T08:12:01Z INFO radarr: Import complete, keys=3",
  ])("%s", (line) => {
    const r = redactLine(line);
    expect(r.text).toBe(line);
    expect(r.count).toBe(0);
  });
});
