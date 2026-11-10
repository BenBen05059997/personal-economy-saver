import { cookiePolicy } from "./supabase-auth";

export const INVITE_COOKIE = "pes-invite";
export const INVITE_COOKIE_AGE = 3_600;
export const inviteCookiePolicy = { ...cookiePolicy, path: "/api/auth/finish" };
