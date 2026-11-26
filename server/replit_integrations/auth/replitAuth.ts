import session from "express-session";
import type { Express, RequestHandler } from "express";
import connectPg from "connect-pg-simple";
import bcrypt from "bcryptjs";
import { authStorage } from "./storage";
import { recordFunnelEvent } from "../../funnel";
import { PUBLIC_SIGNUP_ENABLED } from "@shared/platform-config";
import { isPlausibleEmail, normalizeEmail, rateLimit } from "../../auth-guards";

const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10 });
const loginIpLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });
const loginEmailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  key: (req) => `email:${normalizeEmail(req.body?.email) || req.ip}`,
});

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000;
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
  });
  return session({
    secret: process.env.SESSION_SECRET!,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: sessionTtl,
    },
  });
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());

  app.post("/api/auth/register", registerLimiter, async (req, res) => {
    if (!PUBLIC_SIGNUP_ENABLED) {
      return res.status(403).json({ message: "New account registration is temporarily closed." });
    }

    try {
      const { email: rawEmail, password, firstName, lastName, phone, smsConsent, emailConsent } = req.body;
      const email = normalizeEmail(rawEmail);
      recordFunnelEvent("signup_attempt", { email, req });
      if (!email || !password) {
        recordFunnelEvent("signup_error", { email, errorReason: "missing email or password", req });
        return res.status(400).json({ message: "Email and password are required." });
      }
      if (!isPlausibleEmail(email)) {
        recordFunnelEvent("signup_error", { email, errorReason: "invalid email format", req });
        return res.status(400).json({ message: "Please enter a valid email address." });
      }
      if (typeof password !== "string" || password.length < 6) {
        recordFunnelEvent("signup_error", { email, errorReason: "password too short", req });
        return res.status(400).json({ message: "Password must be at least 6 characters." });
      }

      const existing = await authStorage.getUserByEmail(email);
      if (existing) {
        recordFunnelEvent("signup_duplicate", { email, errorReason: "email already registered", req });
        return res.status(409).json({ message: "An account with this email already exists." });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      const user = await authStorage.createUser({
        email,
        password: hashedPassword,
        firstName: firstName || "",
        lastName: lastName || "",
        phone: phone || "",
        smsConsent: smsConsent ?? false,
        emailConsent: emailConsent ?? false,
      });

      (req.session as any).userId = user.id;
      recordFunnelEvent("signup_success", { email, req });
      const { password: _, ...safeUser } = user;
      res.json(safeUser);
    } catch (error) {
      console.error("Registration error:", error);
      recordFunnelEvent("signup_error", {
        email: req.body?.email,
        errorReason: error instanceof Error ? error.message : "unknown server error",
        req,
      });
      res.status(500).json({ message: "Registration failed. Please try again." });
    }
  });

  app.post("/api/auth/login", loginIpLimiter, loginEmailLimiter, async (req, res) => {
    try {
      const email = normalizeEmail(req.body?.email);
      const password = req.body?.password;
      if (!email || typeof password !== "string" || !password) {
        return res.status(400).json({ message: "Email and password are required." });
      }

      const user = await authStorage.getUserByEmail(email);
      if (!user || !user.password) {
        recordFunnelEvent("login_error", { email, errorReason: "no account for email", req });
        return res.status(401).json({ message: "Invalid email or password." });
      }

      const valid = await bcrypt.compare(password, user.password);
      if (!valid) {
        recordFunnelEvent("login_error", { email, errorReason: "wrong password", req });
        return res.status(401).json({ message: "Invalid email or password." });
      }

      (req.session as any).userId = user.id;
      const { password: _, ...safeUser } = user;
      res.json(safeUser);
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ message: "Login failed. Please try again." });
    }
  });

  app.post("/api/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        console.error("Logout error:", err);
        return res.status(500).json({ message: "Logout failed" });
      }
      res.clearCookie("connect.sid");
      res.json({ message: "Logged out" });
    });
  });

  app.get("/api/logout", (req, res) => {
    req.session.destroy((err) => {
      res.clearCookie("connect.sid");
      res.redirect("/");
    });
  });
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  const userId = (req.session as any)?.userId;
  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const user = await authStorage.getUser(userId);
  if (!user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  (req as any).user = user;
  next();
};
