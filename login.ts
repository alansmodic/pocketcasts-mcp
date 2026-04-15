import { pocketcasts } from "./pocketcasts";

const email = prompt("Email:");
const password = prompt("Password:");

if (!email || !password) {
  console.error("Email and password are required.");
  process.exit(1);
}

try {
  await pocketcasts.login(email, password);
  console.log("Logged in. Credentials saved to auth.json.");
} catch (e: any) {
  console.error(`Login failed: ${e.message}`);
  process.exit(1);
}
