import bcrypt from "bcryptjs";
import { loginSchema } from "@netmon/shared-validation";
import { ApiError, clientIp, handler, ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { rateLimit } from "@/lib/rate-limit";
import { audit } from "@/lib/audit";

export const POST = handler(async (req) => {
  const ip = clientIp(req);
  if (!(await rateLimit(`login:${ip}`, 5, 60))) throw new ApiError(429, "RATE_LIMITED", "Too many attempts, try again shortly");
  const { email, password } = loginSchema.parse(await req.json());
  // Per-account limit stops slow distributed guessing against one email.
  if (!(await rateLimit(`login-acct:${email.toLowerCase()}`, 10, 15 * 60))) throw new ApiError(429, "RATE_LIMITED", "Too many attempts for this account, try again later");
  const user = await prisma.user.findUnique({ where: { email } });
  const valid = user ? await bcrypt.compare(password, user.passwordHash) : false;
  if (!user || !valid || user.disabled) {
    await audit("auth.login_failed", { ip, data: { email } });
    throw new ApiError(401, "INVALID_CREDENTIALS", "Invalid email or password");
  }
  const s = await getSession();
  const now = Math.floor(Date.now() / 1000);
  s.userId = user.id; s.role = user.role; s.ver = user.sessionVersion; s.iat = now; s.seen = now;
  await s.save();
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await audit("auth.login", { userId: user.id, ip, userAgent: req.headers.get("user-agent") ?? undefined });
  return ok({ id: user.id, email: user.email });
}, { public: true });
