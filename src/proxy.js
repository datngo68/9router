import { proxy as guard } from "@/dashboardGuard";

// Next.js 16 renamed `middleware` to `proxy`. This file is the entry the
// framework loads automatically; logic lives in src/dashboardGuard.js.
export default async function proxy(request) {
  return guard(request);
}

export const config = {
  matcher: [
    // Bao toàn bộ request trừ static assets và Next internals.
    "/((?!_next/static|_next/image|favicon.ico|favicon.svg|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf|otf|css|js|map)).*)",
  ],
};
