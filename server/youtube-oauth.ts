import type { Express, Request } from "express";
import { createCipheriv, createHash, randomBytes, scryptSync } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { youtubeConnections } from "@shared/schema";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
];

function config() {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  const sessionSecret = process.env.SESSION_SECRET;
  if (!clientId || !clientSecret || !sessionSecret) {
    throw new Error("YouTube OAuth is not configured");
  }
  return { clientId, clientSecret, sessionSecret };
}

function redirectUri(req: Request): string {
  if (process.env.YOUTUBE_REDIRECT_URI) return process.env.YOUTUBE_REDIRECT_URI;
  return `${req.protocol}://${req.get("host")}/api/youtube/callback`;
}

function encrypt(value: string, secret: string): string {
  const key = scryptSync(secret, "youtube-oauth-token-v1", 32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString("base64url")).join(".");
}

function oauthSession(req: Request): Record<string, any> {
  return req.session as any;
}

export function registerYoutubeOAuthRoutes(app: Express) {
  app.get("/api/youtube/connect", isAuthenticated, (req, res) => {
    try {
      const { clientId } = config();
      const state = randomBytes(24).toString("base64url");
      const verifier = randomBytes(48).toString("base64url");
      const challenge = createHash("sha256").update(verifier).digest("base64url");
      oauthSession(req).youtubeOAuth = {
        state,
        verifier,
        userId: (req as any).user.id,
        expiresAt: Date.now() + 10 * 60 * 1000,
      };
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri(req),
        response_type: "code",
        scope: SCOPES.join(" "),
        access_type: "offline",
        prompt: "consent",
        include_granted_scopes: "true",
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
      });
      req.session.save((error) => {
        if (error) return res.redirect("/youtube?error=session");
        res.redirect(`${AUTH_URL}?${params}`);
      });
    } catch (error) {
      console.error("[YouTube OAuth] Connect failed:", error instanceof Error ? error.message : error);
      res.redirect("/youtube?error=configuration");
    }
  });

  app.get("/api/youtube/callback", isAuthenticated, async (req, res) => {
    const pending = oauthSession(req).youtubeOAuth;
    delete oauthSession(req).youtubeOAuth;
    try {
      const code = typeof req.query.code === "string" ? req.query.code : "";
      const state = typeof req.query.state === "string" ? req.query.state : "";
      if (!pending || !code || state !== pending.state || pending.expiresAt < Date.now()) {
        return res.redirect("/youtube?error=invalid_state");
      }
      if (pending.userId !== (req as any).user.id) {
        return res.redirect("/youtube?error=invalid_user");
      }

      const { clientId, clientSecret, sessionSecret } = config();
      const tokenResponse = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri(req),
          grant_type: "authorization_code",
          code_verifier: pending.verifier,
        }),
      });
      const tokens: any = await tokenResponse.json();
      if (!tokenResponse.ok || !tokens.access_token) {
        throw new Error(`Token exchange failed (${tokenResponse.status})`);
      }

      const channelResponse = await fetch(
        "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
        { headers: { Authorization: `Bearer ${tokens.access_token}` } },
      );
      const channelData: any = channelResponse.ok ? await channelResponse.json() : null;
      const channel = channelData?.items?.[0];
      const userId = (req as any).user.id;
      const existing = await db.query.youtubeConnections.findFirst({
        where: eq(youtubeConnections.userId, userId),
      });
      const values = {
        userId,
        channelId: channel?.id ?? null,
        channelTitle: channel?.snippet?.title ?? null,
        accessTokenEncrypted: encrypt(tokens.access_token, sessionSecret),
        refreshTokenEncrypted: tokens.refresh_token
          ? encrypt(tokens.refresh_token, sessionSecret)
          : existing?.refreshTokenEncrypted ?? null,
        tokenExpiresAt: tokens.expires_in
          ? new Date(Date.now() + Number(tokens.expires_in) * 1000)
          : null,
        scopes: tokens.scope ?? SCOPES.join(" "),
        updatedAt: new Date(),
      };
      await db.insert(youtubeConnections).values(values).onConflictDoUpdate({
        target: youtubeConnections.userId,
        set: values,
      });
      res.redirect("/youtube?connected=1");
    } catch (error) {
      console.error("[YouTube OAuth] Callback failed:", error instanceof Error ? error.message : error);
      res.redirect("/youtube?error=callback");
    }
  });

  app.get("/api/youtube/status", isAuthenticated, async (req, res) => {
    const connection = await db.query.youtubeConnections.findFirst({
      where: eq(youtubeConnections.userId, (req as any).user.id),
      columns: { channelId: true, channelTitle: true, createdAt: true, updatedAt: true },
    });
    res.json({
      configured: Boolean(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET),
      connected: Boolean(connection),
      channel: connection
        ? { id: connection.channelId, title: connection.channelTitle, connectedAt: connection.createdAt }
        : null,
    });
  });

  app.post("/api/youtube/disconnect", isAuthenticated, async (req, res) => {
    await db.delete(youtubeConnections).where(eq(youtubeConnections.userId, (req as any).user.id));
    res.json({ connected: false });
  });
}