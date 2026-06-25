/**
 * generate-orchestrator.ts — Orchestrates a full study (re)generation:
 * prospects search/merge by radius, empirical stats, optional iteration prompt,
 * competitor section and the LLM study generation. Pure computation: it reads
 * the already-loaded study record and returns the values to persist; the route
 * stays thin (validate → orchestrate → persist).
 *
 * Imports the same collaborators the route used so existing test mocks
 * (study-generator / places / competitors) keep intercepting.
 */

import { collectRealData, generateStudy } from "./study-generator";
import { searchProspects, isConfigured, geocodeZone } from "./places";
import { mergeProspects, retagProspects, type RadiusContext } from "./prospects";
import { buildCompetitorSection } from "./competitors";
import { computeProspectStats, renderProspectStats } from "./agency-profile";
import { buildStudyIterationPrompt } from "./prompt-master";
import { parseSections, parseProspects } from "./serialization";
import type { Prospect, StudySection, MarketStudyInputs } from "./types";

export interface RunStudyGenerationInput {
  inputs: MarketStudyInputs;
  sections: unknown;
  prospects: unknown;
  model?: string | null;
  reasoningEffort?: string | null;
}

export interface RunStudyGenerationOptions {
  feedback?: string;
  refreshProspects?: boolean;
  generatePrompt?: boolean;
}

export interface RunStudyGenerationResult {
  sections: StudySection[];
  prospects: Prospect[];
  successScore: number | null;
  placesWarning?: string;
  generatedPrompt?: string;
}

export async function runStudyGeneration(
  study: RunStudyGenerationInput,
  opts: RunStudyGenerationOptions
): Promise<RunStudyGenerationResult> {
  const { feedback, refreshProspects, generatePrompt } = opts;
  const inputs = study.inputs;
  const realData = await collectRealData();

  // Iterative mode: the study already has generated sections
  const previousSections = parseSections(study.sections);
  const isIteration = previousSections.length > 0;

  // ── Prospects FIRST so the study can be anchored on real scraped figures ──
  let prospects = parseProspects(study.prospects);
  let placesWarning: string | undefined;
  const wantsProspects = !isIteration || refreshProspects === true;

  // Resolve the action-radius center once (cached) to tag/purge by distance.
  const needCenter = isConfigured() && (wantsProspects || prospects.some((p) => p.lat !== undefined));
  const center = needCenter ? await geocodeZone(inputs.zone, inputs.postalCode) : null;
  const radiusCtx: RadiusContext | undefined =
    center ? { center, radiusKm: inputs.radiusKm } : undefined;

  if (wantsProspects && isConfigured() && inputs.targetSectors?.length) {
    const result = await searchProspects(inputs.zone, inputs.targetSectors, {
      radiusKm: inputs.radiusKm,
      postalCode: inputs.postalCode,
    });
    placesWarning = result.warning;
    // Merge by placeId: refresh data, never lose existing statuses, re-tag by radius
    prospects = mergeProspects(prospects, result.prospects, radiusCtx);
  } else if (wantsProspects && !isConfigured()) {
    placesWarning = "Requiere GOOGLE_MAPS_API_KEY para activar prospección";
  } else if (radiusCtx) {
    // No refresh, but keep outOfRadius flags fresh against the current radius
    prospects = retagProspects(prospects, radiusCtx);
  }

  // Real prospect figures → empirical base for the study prompt
  const stats = computeProspectStats(prospects);
  const prospectStatsBlock = stats
    ? renderProspectStats(stats, inputs.radiusKm, inputs.zone)
    : undefined;

  // Optional: let the prompt-master craft the optimal iteration prompt
  let effectiveFeedback = feedback;
  let generatedPrompt: string | undefined;
  if (generatePrompt) {
    generatedPrompt = await buildStudyIterationPrompt({
      inputs,
      realData,
      prospectStatsBlock,
      userHint: feedback,
    });
    effectiveFeedback = generatedPrompt;
  }

  // Build competitor section (uses Places if available)
  const competitorSection = await buildCompetitorSection(inputs.zone, inputs, isConfigured());

  // Generate study sections + successScore (iterating over previous content if any)
  const { sections, successScore } = await generateStudy(
    inputs,
    realData,
    competitorSection,
    isIteration ? { previousSections, feedback: effectiveFeedback } : undefined,
    prospectStatsBlock,
    { model: study.model ?? undefined, reasoningEffort: study.reasoningEffort ?? undefined }
  );

  return { sections, prospects, successScore, placesWarning, generatedPrompt };
}
