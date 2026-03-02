import type { Express } from "express";
import { authStorage } from "./storage";
import { isAuthenticated } from "./replitAuth";
import { z } from "zod";

const onboardingSchema = z.object({
  salutation: z.string().min(1),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(7),
  smsConsent: z.boolean(),
  emailConsent: z.boolean(),
});

export function registerAuthRoutes(app: Express): void {
  app.get("/api/auth/user", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await authStorage.getUser(userId);
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  app.post("/api/onboarding", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const parsed = onboardingSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid data", details: parsed.error.flatten() });
      }
      const { salutation, firstName, lastName, email, phone, smsConsent, emailConsent } = parsed.data;
      const user = await authStorage.completeOnboarding(userId, {
        salutation,
        firstName,
        lastName,
        email,
        phone,
        smsConsent,
        emailConsent,
      });
      res.json(user);
    } catch (error: any) {
      if (error?.code === "23505" && error?.constraint?.includes("email")) {
        return res.status(409).json({ message: "This email address is already in use. Please use a different email." });
      }
      console.error("Error completing onboarding:", error);
      res.status(500).json({ message: "Failed to complete onboarding" });
    }
  });
}
