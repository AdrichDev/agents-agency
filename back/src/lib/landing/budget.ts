/**
 * budget.ts — Auto-create the draft budget linked to a landing project the
 * first time a QR is attached. Extracted from routes/landing.ts.
 */

import { prisma } from "@/lib/db";
import { nextQuoteNumber, withCodeRetry } from "@/lib/codes";

/**
 * Creates a draft budget with the landing + QR service lines for the given
 * project. Used when a QR URL is set for the first time.
 */
export async function createLandingQrBudget(projectName: string): Promise<void> {
  // Código y create en el mismo retry: si otra petición consume el número
  // (P2002 en budget.quoteNumber), recalcula y reintenta el create.
  await withCodeRetry(async () =>
    prisma.budget.create({
      data: {
        quoteNumber: await nextQuoteNumber(),
        status: "draft",
        lines: {
          create: [
            {
              serviceId: "landing",
              name: `Landing Page — ${projectName}`,
              description: "Landing page generada con IA",
              quantity: 1,
              implPrice: 0,
              maintPrice: 0,
              position: 0,
            },
            {
              serviceId: "qr",
              name: "Código QR",
              description: "QR dinámico enlazado a la landing",
              quantity: 1,
              implPrice: 0,
              maintPrice: 0,
              position: 1,
            },
          ],
        },
      },
    }),
  );
}
