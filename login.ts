// Local helper: enroll yourself against a running server from the terminal.
//
// This is a convenience for the maintainer / power users. Most people should use
// the web form at the server root (GET /). This script just POSTs to /enroll.
//
//   ENROLL_URL=https://your-app.railway.app bun run login

const base = process.env.ENROLL_URL || `http://localhost:${process.env.PORT || 3001}`;

const email = prompt("Pocket Casts email:");
const password = prompt("Pocket Casts password:");

if (!email || !password) {
  console.error("Email and password are required.");
  process.exit(1);
}

const res = await fetch(`${base}/enroll`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password }),
});

const data: any = await res.json();
if (!res.ok) {
  console.error(`Enrollment failed: ${data.error ?? res.status}`);
  process.exit(1);
}

console.log("\nConnected. Your access token (store it now — it won't be shown again):\n");
console.log(`  ${data.bearer}\n`);
console.log("Use it as a bearer token against the /mcp endpoint.");
