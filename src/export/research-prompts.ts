export const AI_CONTEXT_NOTE =
  'The selected export scope describes which session events were included. Calculation status and coverage describe what the ephemeris could calculate. A model may have insufficient context or recall to analyze every part at once. Token estimates are approximate and exclude the model’s other inputs and output.';

export const AI_RESEARCH_INSTRUCTIONS = [
  'Use the manifest or standalone export as the scope, date policy and natal chart reference. Cite event IDs and part numbers in findings.',
  'For a multipart package, supply the manifest first and every numbered part in order. Check the package ID, inclusive event indexes and counts. Acknowledge each part and identify any gap before making a final synthesis.',
  'If the entire package exceeds the model’s reliable context, analyze one part at a time. Save cited findings and series IDs for each part, then synthesize those notes with the manifest. Disclose which parts and IDs each conclusion covers.',
  'Distinguish calculated contacts and timing from symbolic astrology and relevance scores. Interpretations describe possibilities for reflection. Avoid treating them as factual life events, causal evidence or predictions.',
  'Each axis companion records another solved window for the same physical contact, including ends outside the display focus. Count the host contact once and use each window’s own orb and pass data.',
  'Keep optional selected-moment transit synthesis separate from the range timeline. Respect coverage gaps, clipped windows, incomplete series, and the chosen date policy. Avoid inferring or reconstructing birth identity or hidden dates.',
] as const;

export function partInstruction(partNumber: number, totalParts: number): string {
  return partNumber === totalParts
    ? 'Confirm all parts and counts against the manifest before synthesis.'
    : 'Confirm receipt and wait for the remaining numbered parts before final synthesis.';
}
