/**
 * One-time helper: exchange a Google OAuth consent for a long-lived refresh token.
 *
 * Usage:
 *   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... node scripts/google-auth.mjs
 *
 * Then copy the printed GOOGLE_REFRESH_TOKEN into your .env file.
 */
import { createServer } from 'node:http';
import { google } from 'googleapis';

const PORT = 5858;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;
const SCOPES = ['https://www.googleapis.com/auth/calendar'];

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET before running this.');
  process.exit(1);
}

const auth = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

const url = auth.generateAuthUrl({
  access_type: 'offline',
  // Google only returns a refresh token on first consent unless we force the prompt.
  prompt: 'consent',
  scope: SCOPES,
});

const server = createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://localhost:${PORT}`);
  if (requestUrl.pathname !== '/oauth2callback') {
    res.writeHead(404).end();
    return;
  }

  const code = requestUrl.searchParams.get('code');
  if (!code) {
    res.writeHead(400).end('No code in callback.');
    return;
  }

  try {
    const { tokens } = await auth.getToken(code);
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('Done. Check your terminal, then close this tab.');

    if (!tokens.refresh_token) {
      console.error(
        '\nGoogle did not return a refresh token. Revoke this app at\n' +
          'https://myaccount.google.com/permissions and run this script again.',
      );
    } else {
      console.log('\nAdd this to your .env:\n');
      console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`);
    }
  } catch (error) {
    res.writeHead(500).end('Token exchange failed.');
    console.error('\nToken exchange failed:', error.message);
  } finally {
    server.close();
  }
});

server.listen(PORT, () => {
  console.log('\nOpen this URL, pick the Google account whose calendar you want:\n');
  console.log(`${url}\n`);
  console.log(`Waiting on ${REDIRECT_URI} ...`);
});
