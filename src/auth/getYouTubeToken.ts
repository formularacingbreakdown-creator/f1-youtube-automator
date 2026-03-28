import "dotenv/config";
import { google } from "googleapis";
import http from "node:http";
import { URL } from "node:url";

const SCOPES = ["https://www.googleapis.com/auth/youtube.upload"];
const REDIRECT_PORT = 3000;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}`;

async function main() {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error("Error: Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET in your .env file first.");
    process.exit(1);
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

  const authorizeUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });

  console.log("1. Open this URL in your browser:\n");
  console.log(`   ${authorizeUrl}\n`);
  console.log("2. Authorize the application and wait for the redirect...\n");

  const code = await waitForAuthCode();

  const { tokens } = await oauth2Client.getToken(code);

  if (!tokens.refresh_token) {
    console.error("Error: No refresh token received. Make sure you revoked prior access at https://myaccount.google.com/permissions and try again.");
    process.exit(1);
  }

  console.log("Success! Add this to your .env file:\n");
  console.log(`YOUTUBE_REFRESH_TOKEN=${tokens.refresh_token}`);
}

function waitForAuthCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url!, `http://localhost:${REDIRECT_PORT}`);
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");

      if (error) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(`<h1>Authorization failed</h1><p>${error}</p>`);
        server.close();
        reject(new Error(`Authorization denied: ${error}`));
        return;
      }

      if (code) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<h1>Authorization successful!</h1><p>You can close this tab and return to the terminal.</p>");
        server.close();
        resolve(code);
        return;
      }

      res.writeHead(404);
      res.end();
    });

    server.listen(REDIRECT_PORT, () => {
      console.log(`Listening for OAuth callback on http://localhost:${REDIRECT_PORT}...`);
    });

    server.on("error", reject);
  });
}

main().catch((error) => {
  console.error("Failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
