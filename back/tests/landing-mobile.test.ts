import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateMobileScaffold } from "@/lib/landing/mobile";

// Mock openai module
vi.mock("@/lib/openai", () => ({
  openai: {
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
  },
  DEFAULT_MODEL: "test-model",
  STRONG_MODEL: "test-strong-model",
}));

import { openai } from "@/lib/openai";

const mockCreate = openai.chat.completions.create as ReturnType<typeof vi.fn>;

function makeCompletion(content: string) {
  return { choices: [{ message: { content } }] };
}

beforeEach(() => {
  vi.clearAllMocks();
});

const sampleAnswers = {
  purpose: { value: "App de delivery de comida", assumedByAI: false },
  businessName: { value: "QuickEats", assumedByAI: false },
  palette: { value: "Rojo y amarillo", assumedByAI: false },
  style: { value: "Moderno y vibrante", assumedByAI: false },
  sections: { value: "Home, Menú, Carrito, Perfil", assumedByAI: false },
};

const branding = {
  businessName: "QuickEats",
  palette: "Rojo y amarillo",
  style: "Moderno y vibrante",
  sections: "Home, Menú, Carrito, Perfil",
};

describe("generateMobileScaffold — Expo structure", () => {
  it("returns Expo scaffold files with expected paths", async () => {
    const expoFiles = {
      "App.tsx": "import React from 'react';\nexport default function App() { return null; }",
      "app.json": JSON.stringify({ expo: { name: "QuickEats", slug: "quickeats" } }),
      "package.json": JSON.stringify({ name: "quickeats", dependencies: { expo: "~51.0.0" } }),
      "screens/HomeScreen.tsx": "export default function HomeScreen() { return null; }",
    };
    mockCreate.mockResolvedValueOnce(makeCompletion(JSON.stringify(expoFiles)));

    const result = await generateMobileScaffold({
      answers: sampleAnswers,
      branding,
      target: "android",
      stack: "expo",
    });

    expect(result.files).toBeDefined();
    expect(Object.keys(result.files).length).toBeGreaterThan(0);
    // Expo scaffold should have App.tsx or app.json
    const hasExpoFiles =
      "App.tsx" in result.files || "app.json" in result.files;
    expect(hasExpoFiles).toBe(true);
    expect(result.truncated).toBe(false);
  });

  it("calls STRONG_MODEL for generation", async () => {
    const files = { "App.tsx": "export default function App() { return null; }" };
    mockCreate.mockResolvedValueOnce(makeCompletion(JSON.stringify(files)));

    await generateMobileScaffold({
      answers: sampleAnswers,
      branding,
      target: "ios",
      stack: "expo",
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: "test-strong-model" })
    );
  });
});

describe("generateMobileScaffold — Flutter structure", () => {
  it("returns Flutter scaffold files with expected paths", async () => {
    const flutterFiles = {
      "lib/main.dart": "import 'package:flutter/material.dart';\nvoid main() => runApp(MyApp());",
      "pubspec.yaml": "name: quickeats\nflutter:\n  uses-material-design: true",
      "lib/screens/home_screen.dart": "class HomeScreen extends StatelessWidget {}",
    };
    mockCreate.mockResolvedValueOnce(makeCompletion(JSON.stringify(flutterFiles)));

    const result = await generateMobileScaffold({
      answers: sampleAnswers,
      branding,
      target: "android",
      stack: "flutter",
    });

    expect(result.files).toBeDefined();
    // Flutter scaffold should have lib/main.dart or pubspec.yaml
    const hasFlutterFiles =
      "lib/main.dart" in result.files || "pubspec.yaml" in result.files;
    expect(hasFlutterFiles).toBe(true);
  });
});

describe("generateMobileScaffold — error handling", () => {
  it("retries on invalid JSON response and throws after 3 attempts", async () => {
    const junk = "invalid json response";
    mockCreate
      .mockResolvedValueOnce(makeCompletion(junk))
      .mockResolvedValueOnce(makeCompletion(junk))
      .mockResolvedValueOnce(makeCompletion(junk));

    await expect(
      generateMobileScaffold({
        answers: sampleAnswers,
        branding,
        target: "android",
        stack: "expo",
      })
    ).rejects.toThrow();

    expect(mockCreate).toHaveBeenCalledTimes(3);
  });
});
