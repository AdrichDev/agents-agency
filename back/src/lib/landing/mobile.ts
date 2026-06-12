/**
 * mobile.ts — Genera scaffold de app móvil Expo o Flutter usando STRONG_MODEL.
 * Refleja el branding y secciones de la landing generada.
 */

import { callWithRetry, type FilesResult } from "./llm-files";
import { STRONG_MODEL } from "@/lib/openai";
import type { AnswerEntry } from "./interview";

export type MobileStack = "expo" | "flutter";
export type MobileTarget = "android" | "ios";

/** Estructura mínima de referencia para Expo (App.tsx + config). */
const EXPO_SCAFFOLD_HINT = `Expo React Native project structure:
- App.tsx (main component with navigation and screens)
- app.json (Expo configuration with name, slug, version, icon, splash)
- package.json (with expo, react-native, @react-navigation/native dependencies)
- assets/splash.png (placeholder comment)
- screens/HomeScreen.tsx
- screens/ContactScreen.tsx
- components/Header.tsx
- components/Footer.tsx`;

/** Estructura mínima de referencia para Flutter. */
const FLUTTER_SCAFFOLD_HINT = `Flutter project structure:
- lib/main.dart (main entry point with MaterialApp)
- lib/screens/home_screen.dart
- lib/screens/contact_screen.dart
- lib/widgets/app_header.dart
- lib/widgets/app_footer.dart
- pubspec.yaml (with flutter sdk, cupertino_icons dependencies)
- README.md (basic setup instructions)`;

export interface MobileScaffoldInput {
  answers: Record<string, AnswerEntry>;
  branding: {
    businessName: string;
    palette: string;
    style: string;
    sections: string;
  };
  target: MobileTarget;
  stack: MobileStack;
}

/**
 * Generates a mobile app scaffold reflecting the landing page branding.
 */
export async function generateMobileScaffold(
  input: MobileScaffoldInput
): Promise<FilesResult> {
  const { answers, branding, target, stack } = input;

  const scaffoldHint = stack === "expo" ? EXPO_SCAFFOLD_HINT : FLUTTER_SCAFFOLD_HINT;
  const stackLabel = stack === "expo" ? "Expo React Native (TypeScript)" : "Flutter (Dart)";

  const systemPrompt = `You are a mobile app scaffolding generator. Create a ${stackLabel} app scaffold.

TARGET: ${target} app

SCAFFOLD STRUCTURE REFERENCE:
${scaffoldHint}

BRANDING TO IMPLEMENT:
- Business name: ${branding.businessName}
- Color palette: ${branding.palette}
- Visual style: ${branding.style}
- Sections to include: ${branding.sections}

REQUIREMENTS:
- All files must be complete and runnable (no "..." truncation)
- Implement the brand colors in the UI components
- Include the same sections as the landing page
- Use placeholder images/assets where needed
- For Expo: use TypeScript, functional components, React Navigation
- For Flutter: use StatelessWidget/StatefulWidget patterns, Material Design

CRITICAL:
- Return ONLY a JSON object { "path": "content" } — no markdown, no explanation
- All paths must be relative to the project root (e.g., "lib/main.dart", "App.tsx")`;

  const userContent = `Generate ${target} ${stack} scaffold for: ${branding.businessName}
Purpose: ${answers["purpose"]?.value ?? "mobile app"}
Language/tone: ${answers["language"]?.value ?? "Spanish"}`;

  return callWithRetry(
    STRONG_MODEL,
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    16000,
    { requireIndexHtml: false }
  );
}
